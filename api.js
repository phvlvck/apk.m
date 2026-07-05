// ============================================
// API الرئيسية - Netlify Function
// ============================================

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ============================================
// الإعدادات الأساسية
// ============================================
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '32-byte-key-for-aes-256-gcm';
const RATE_LIMIT = {
    windowMs: 60000, // 1 دقيقة
    max: 100 // الحد الأقصى للطلبات
};

// ============================================
// قاعدة البيانات
// ============================================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// أدوات التشفير
// ============================================
class EncryptionManager {
    static encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'base64'), iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    }

    static decrypt(encryptedData) {
        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            Buffer.from(ENCRYPTION_KEY, 'base64'),
            Buffer.from(encryptedData.iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
        
        let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }
}

// ============================================
// إدارة الجلسات
// ============================================
class SessionManager {
    static generateToken(userId, deviceId = null) {
        const payload = {
            userId,
            deviceId,
            exp: Math.floor(Date.now() / 1000) + 3600 // ساعة واحدة
        };
        
        return jwt.sign(payload, JWT_SECRET);
    }

    static verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (error) {
            return null;
        }
    }

    static async validateSession(token, userId) {
        if (!token) return false;
        
        const decoded = this.verifyToken(token);
        if (!decoded || decoded.userId !== userId) return false;
        
        // التحقق من أن الجلسة موجودة في قاعدة البيانات
        const { data, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('user_id', userId)
            .eq('token', token)
            .single();
            
        if (error || !data) return false;
        
        // التحقق من انتهاء صلاحية الجلسة
        if (new Date(data.expires_at) < new Date()) {
            await supabase.from('sessions').delete().eq('id', data.id);
            return false;
        }
        
        return true;
    }
}

// ============================================
// Rate Limiting
// ============================================
class RateLimiter {
    constructor() {
        this.requests = new Map();
    }

    check(ip) {
        const now = Date.now();
        const windowStart = now - RATE_LIMIT.windowMs;
        
        if (!this.requests.has(ip)) {
            this.requests.set(ip, []);
        }
        
        const requests = this.requests.get(ip);
        const recentRequests = requests.filter(time => time > windowStart);
        
        if (recentRequests.length >= RATE_LIMIT.max) {
            return false;
        }
        
        recentRequests.push(now);
        this.requests.set(ip, recentRequests);
        return true;
    }
}

const rateLimiter = new RateLimiter();

// ============================================
// Middleware
// ============================================
const authMiddleware = async (event) => {
    const authHeader = event.headers.authorization;
    if (!authHeader) {
        return { error: 'Unauthorized', status: 401 };
    }
    
    const token = authHeader.replace('Bearer ', '');
    const decoded = SessionManager.verifyToken(token);
    
    if (!decoded) {
        return { error: 'Invalid token', status: 401 };
    }
    
    // التحقق من الجلسة في قاعدة البيانات
    const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('token', token)
        .eq('user_id', decoded.userId)
        .single();
        
    if (error || !data) {
        return { error: 'Session expired', status: 401 };
    }
    
    return { user: decoded, token };
};

// ============================================
// Handlers
// ============================================
const handlers = {
    // ============================================
    // POST /login
    // ============================================
    async login(event) {
        const { email, password } = JSON.parse(event.body);
        
        // التحقق من صحة المدخلات
        if (!email || !password) {
            return { error: 'Email and password required', status: 400 };
        }
        
        // البحث عن المستخدم
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();
            
        if (error || !user) {
            // تسجيل محاولة فاشلة
            await this.logEvent('login_failed', { email, reason: 'User not found' });
            return { error: 'Invalid credentials', status: 401 };
        }
        
        // التحقق من كلمة المرور
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            await this.logEvent('login_failed', { email, reason: 'Invalid password' });
            return { error: 'Invalid credentials', status: 401 };
        }
        
        // إنشاء الجلسة
        const token = SessionManager.generateToken(user.id);
        
        // حفظ الجلسة في قاعدة البيانات
        await supabase.from('sessions').insert({
            user_id: user.id,
            token: token,
            expires_at: new Date(Date.now() + 3600000),
            user_agent: event.headers['user-agent'],
            ip: event.headers['x-forwarded-for'] || event.headers['client-ip']
        });
        
        // تسجيل الدخول الناجح
        await this.logEvent('login_success', { email, userId: user.id });
        
        return {
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        };
    },

    // ============================================
    // POST /verify-license
    // ============================================
    async verifyLicense(event) {
        const { licenseCode, deviceId } = JSON.parse(event.body);
        
        if (!licenseCode || !deviceId) {
            return { error: 'License code and device ID required', status: 400 };
        }
        
        // البحث عن الترخيص
        const { data: license, error } = await supabase
            .from('licenses')
            .select('*')
            .eq('code', licenseCode)
            .single();
            
        if (error || !license) {
            await this.logEvent('license_invalid', { licenseCode, deviceId, reason: 'Not found' });
            return { error: 'Invalid license', status: 404 };
        }
        
        // التحقق من انتهاء الترخيص
        if (new Date(license.end_date) < new Date()) {
            await this.logEvent('license_expired', { licenseCode, deviceId });
            return { error: 'License expired', status: 403 };
        }
        
        // التحقق من عدد الأجهزة
        const { count, error: countError } = await supabase
            .from('devices')
            .select('*', { count: 'exact', head: true })
            .eq('license_id', license.id);
            
        if (countError || count >= license.max_devices) {
            await this.logEvent('license_limit_reached', { licenseCode, deviceId });
            return { error: 'Device limit reached', status: 403 };
        }
        
        // تسجيل الجهاز
        const { data: device, error: deviceError } = await supabase
            .from('devices')
            .insert({
                device_id: deviceId,
                license_id: license.id,
                user_id: license.user_id,
                status: 'active',
                last_seen: new Date()
            })
            .select()
            .single();
            
        if (deviceError) {
            await this.logEvent('device_registration_failed', { licenseCode, deviceId, error: deviceError.message });
            return { error: 'Failed to register device', status: 500 };
        }
        
        await this.logEvent('license_verified', { licenseCode, deviceId });
        
        return {
            valid: true,
            license: {
                id: license.id,
                code: license.code,
                expires_at: license.end_date,
                max_devices: license.max_devices
            },
            device: device
        };
    },

    // ============================================
    // POST /register-device
    // ============================================
    async registerDevice(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { deviceId, deviceName, androidVersion, appVersion } = JSON.parse(event.body);
        
        if (!deviceId) {
            return { error: 'Device ID required', status: 400 };
        }
        
        // التحقق من وجود الجهاز
        const { data: existing, error: existingError } = await supabase
            .from('devices')
            .select('*')
            .eq('device_id', deviceId)
            .single();
            
        if (existing) {
            // تحديث معلومات الجهاز
            const { data, error } = await supabase
                .from('devices')
                .update({
                    name: deviceName || existing.name,
                    android_version: androidVersion || existing.android_version,
                    app_version: appVersion || existing.app_version,
                    last_seen: new Date(),
                    ip: event.headers['x-forwarded-for'] || event.headers['client-ip']
                })
                .eq('id', existing.id)
                .select()
                .single();
                
            if (error) {
                return { error: 'Failed to update device', status: 500 };
            }
            
            return { device: data };
        }
        
        // تسجيل جهاز جديد
        const { data, error } = await supabase
            .from('devices')
            .insert({
                device_id: deviceId,
                name: deviceName || 'Unknown Device',
                android_version: androidVersion || 'Unknown',
                app_version: appVersion || '1.0',
                ip: event.headers['x-forwarded-for'] || event.headers['client-ip'],
                last_seen: new Date(),
                status: 'pending'
            })
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to register device', status: 500 };
        }
        
        await this.logEvent('device_registered', { deviceId, name: deviceName });
        
        return { device: data };
    },

    // ============================================
    // POST /heartbeat
    // ============================================
    async heartbeat(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { deviceId, status } = JSON.parse(event.body);
        
        if (!deviceId) {
            return { error: 'Device ID required', status: 400 };
        }
        
        // تحديث آخر اتصال
        const { data, error } = await supabase
            .from('devices')
            .update({
                last_seen: new Date(),
                status: status || 'active',
                ip: event.headers['x-forwarded-for'] || event.headers['client-ip']
            })
            .eq('device_id', deviceId)
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to update heartbeat', status: 500 };
        }
        
        return { success: true, timestamp: new Date().toISOString() };
    },

    // ============================================
    // GET /dashboard
    // ============================================
    async dashboard(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        // جلب الإحصائيات
        const [
            devicesCount,
            usersCount,
            licensesCount,
            bannedCount,
            activeConnections
        ] = await Promise.all([
            supabase.from('devices').select('*', { count: 'exact', head: true }),
            supabase.from('users').select('*', { count: 'exact', head: true }),
            supabase.from('licenses').select('*', { count: 'exact', head: true })
                .gte('end_date', new Date().toISOString()),
            supabase.from('devices').select('*', { count: 'exact', head: true })
                .eq('status', 'banned'),
            supabase.from('devices').select('*', { count: 'exact', head: true })
                .gte('last_seen', new Date(Date.now() - 300000).toISOString())
        ]);
        
        // جلب آخر العمليات
        const { data: recentActivity } = await supabase
            .from('logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);
            
        return {
            devices: devicesCount.count || 0,
            activeUsers: usersCount.count || 0,
            activeLicenses: licensesCount.count || 0,
            bannedDevices: bannedCount.count || 0,
            activeConnections: activeConnections.count || 0,
            recentActivity: recentActivity || [],
            apiHistory: [10, 25, 18, 40, 35, 50, 45],
            deviceDistribution: { 'Android 12': 40, 'Android 13': 35, 'Android 11': 25 }
        };
    },

    // ============================================
    // GET /devices
    // ============================================
    async devices(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { data, error } = await supabase
            .from('devices')
            .select('*, licenses(code, user_id), users(name)')
            .order('last_seen', { ascending: false });
            
        if (error) {
            return { error: 'Failed to fetch devices', status: 500 };
        }
        
        return data || [];
    },

    // ============================================
    // GET /licenses
    // ============================================
    async licenses(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { data, error } = await supabase
            .from('licenses')
            .select('*, users(name)')
            .order('created_at', { ascending: false });
            
        if (error) {
            return { error: 'Failed to fetch licenses', status: 500 };
        }
        
        // حساب عدد الأجهزة لكل ترخيص
        const licensesWithCount = await Promise.all(data.map(async (license) => {
            const { count } = await supabase
                .from('devices')
                .select('*', { count: 'exact', head: true })
                .eq('license_id', license.id);
                
            return {
                ...license,
                device_count: count || 0
            };
        }));
        
        return licensesWithCount || [];
    },

    // ============================================
    // POST /licenses/create
    // ============================================
    async createLicense(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { userId, maxDevices, duration } = JSON.parse(event.body);
        
        if (!userId || !maxDevices || !duration) {
            return { error: 'User ID, max devices, and duration required', status: 400 };
        }
        
        // إنشاء كود ترخيص فريد
        const code = this.generateLicenseCode();
        
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + duration);
        
        const { data, error } = await supabase
            .from('licenses')
            .insert({
                code,
                user_id: userId,
                max_devices: maxDevices,
                start_date: startDate,
                end_date: endDate,
                status: 'active'
            })
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to create license', status: 500 };
        }
        
        await this.logEvent('license_created', { licenseId: data.id, userId, maxDevices, duration });
        
        return { license: data };
    },

    // ============================================
    // POST /notification/send
    // ============================================
    async sendNotification(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { type, title, message, deviceId } = JSON.parse(event.body);
        
        if (!title || !message) {
            return { error: 'Title and message required', status: 400 };
        }
        
        // حفظ الإشعار في قاعدة البيانات
        const { data, error } = await supabase
            .from('notifications')
            .insert({
                type: type || 'all',
                title,
                message,
                target_device: deviceId || null,
                status: 'sent',
                created_by: auth.user.userId
            })
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to send notification', status: 500 };
        }
        
        await this.logEvent('notification_sent', { notificationId: data.id, type, title });
        
        return { success: true, notification: data };
    },

    // ============================================
    // POST /config/update
    // ============================================
    async updateConfig(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { min_version, update_url, update_message, force_update } = JSON.parse(event.body);
        
        // تحديث الإعدادات
        const { data, error } = await supabase
            .from('settings')
            .upsert({
                key: 'app_config',
                value: JSON.stringify({
                    min_version: min_version || '1.0.0',
                    update_url: update_url || '',
                    update_message: update_message || '',
                    force_update: force_update || false,
                    updated_at: new Date().toISOString()
                })
            })
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to update config', status: 500 };
        }
        
        await this.logEvent('config_updated', { min_version, force_update });
        
        return { success: true };
    },

    // ============================================
    // POST /settings/save
    // ============================================
    async saveSettings(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { app_name, maintenance, heartbeat_interval, debug_mode } = JSON.parse(event.body);
        
        // تحديث الإعدادات
        const { data, error } = await supabase
            .from('settings')
            .upsert({
                key: 'app_settings',
                value: JSON.stringify({
                    app_name: app_name || 'SmartApp',
                    maintenance: maintenance || false,
                    heartbeat_interval: heartbeat_interval || 60,
                    debug_mode: debug_mode || false,
                    updated_at: new Date().toISOString()
                })
            })
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to save settings', status: 500 };
        }
        
        await this.logEvent('settings_updated', { app_name, maintenance });
        
        return { success: true };
    },

    // ============================================
    // GET /config
    // ============================================
    async getConfig(event) {
        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .eq('key', 'app_config')
            .single();
            
        if (error || !data) {
            return {
                min_version: '1.0.0',
                update_url: '',
                update_message: '',
                force_update: false
            };
        }
        
        return JSON.parse(data.value);
    },

    // ============================================
    // GET /settings
    // ============================================
    async getSettings(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .eq('key', 'app_settings')
            .single();
            
        if (error || !data) {
            return {
                app_name: 'SmartApp',
                maintenance: false,
                heartbeat_interval: 60,
                debug_mode: false
            };
        }
        
        return JSON.parse(data.value);
    },

    // ============================================
    // GET /logs
    // ============================================
    async getLogs(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { data, error } = await supabase
            .from('logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);
            
        if (error) {
            return { error: 'Failed to fetch logs', status: 500 };
        }
        
        return data || [];
    },

    // ============================================
    // GET /notifications
    // ============================================
    async getNotifications(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (error) {
            return { error: 'Failed to fetch notifications', status: 500 };
        }
        
        return data || [];
    },

    // ============================================
    // POST /devices/toggle-ban
    // ============================================
    async toggleDeviceBan(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { deviceId } = JSON.parse(event.body);
        
        if (!deviceId) {
            return { error: 'Device ID required', status: 400 };
        }
        
        // جلب الجهاز الحالي
        const { data: device, error: fetchError } = await supabase
            .from('devices')
            .select('*')
            .eq('id', deviceId)
            .single();
            
        if (fetchError || !device) {
            return { error: 'Device not found', status: 404 };
        }
        
        // تبديل الحالة
        const newStatus = device.status === 'banned' ? 'active' : 'banned';
        
        const { data, error } = await supabase
            .from('devices')
            .update({ status: newStatus })
            .eq('id', deviceId)
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to toggle device ban', status: 500 };
        }
        
        await this.logEvent('device_ban_toggled', { deviceId, newStatus });
        
        return { success: true, device: data };
    },

    // ============================================
    // POST /devices/reset
    // ============================================
    async resetDevice(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { deviceId } = JSON.parse(event.body);
        
        if (!deviceId) {
            return { error: 'Device ID required', status: 400 };
        }
        
        // إعادة تعيين الجهاز
        const { data, error } = await supabase
            .from('devices')
            .update({
                status: 'reset',
                last_seen: new Date(),
                reset_at: new Date()
            })
            .eq('id', deviceId)
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to reset device', status: 500 };
        }
        
        await this.logEvent('device_reset', { deviceId });
        
        return { success: true, device: data };
    },

    // ============================================
    // POST /licenses/delete
    // ============================================
    async deleteLicense(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { licenseId } = JSON.parse(event.body);
        
        if (!licenseId) {
            return { error: 'License ID required', status: 400 };
        }
        
        // حذف الترخيص
        const { error } = await supabase
            .from('licenses')
            .delete()
            .eq('id', licenseId);
            
        if (error) {
            return { error: 'Failed to delete license', status: 500 };
        }
        
        await this.logEvent('license_deleted', { licenseId });
        
        return { success: true };
    },

    // ============================================
    // أدوات مساعدة
    // ============================================
    generateLicenseCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
            if (i === 3) code += '-';
        }
        return code;
    },

    async logEvent(type, data = {}) {
        try {
            await supabase.from('logs').insert({
                type: type,
                message: JSON.stringify(data),
                severity: type.includes('error') || type.includes('failed') ? 'error' : 'info',
                source: 'api',
                created_at: new Date()
            });
        } catch (error) {
            console.error('Failed to log event:', error);
        }
    }
};

// ============================================
// Router
// ============================================
exports.handler = async (event, context) => {
    // إعداد CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }
    
    // Rate Limiting
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    if (!rateLimiter.check(clientIp)) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ error: 'Too many requests' })
        };
    }
    
    // تحليل المسار
    const path = event.path.replace('/.netlify/functions/api', '');
    const method = event.httpMethod;
    
    try {
        let result;
        let handler;
        
        // توجيه الطلبات
        switch (path) {
            case '/login':
                handler = handlers.login.bind(handlers);
                break;
            case '/verify-license':
                handler = handlers.verifyLicense.bind(handlers);
                break;
            case '/register-device':
                handler = handlers.registerDevice.bind(handlers);
                break;
            case '/heartbeat':
                handler = handlers.heartbeat.bind(handlers);
                break;
            case '/dashboard':
                handler = handlers.dashboard.bind(handlers);
                break;
            case '/devices':
                if (method === 'GET') handler = handlers.devices.bind(handlers);
                break;
            case '/licenses':
                if (method === 'GET') handler = handlers.licenses.bind(handlers);
                break;
            case '/licenses/create':
                handler = handlers.createLicense.bind(handlers);
                break;
            case '/licenses/delete':
                handler = handlers.deleteLicense.bind(handlers);
                break;
            case '/devices/toggle-ban':
                handler = handlers.toggleDeviceBan.bind(handlers);
                break;
            case '/devices/reset':
                handler = handlers.resetDevice.bind(handlers);
                break;
            case '/notification/send':
                handler = handlers.sendNotification.bind(handlers);
                break;
            case '/config/update':
                handler = handlers.updateConfig.bind(handlers);
                break;
            case '/config':
                handler = handlers.getConfig.bind(handlers);
                break;
            case '/settings':
                if (method === 'GET') handler = handlers.getSettings.bind(handlers);
                else if (method === 'POST') handler = handlers.saveSettings.bind(handlers);
                break;
            case '/settings/save':
                handler = handlers.saveSettings.bind(handlers);
                break;
            case '/logs':
                handler = handlers.getLogs.bind(handlers);
                break;
            case '/notifications':
                handler = handlers.getNotifications.bind(handlers);
                break;
            default:
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Not found' })
                };
        }
        
        if (handler) {
            result = await handler(event);
        }
        
        // التحقق من وجود خطأ في النتيجة
        if (result && result.error) {
            return {
                statusCode: result.status || 400,
                headers,
                body: JSON.stringify({ error: result.error })
            };
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };
        
    } catch (error) {
        console.error('API Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};