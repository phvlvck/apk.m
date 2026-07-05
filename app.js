// ============================================
// التطبيق الرئيسي - Application Core
// ============================================

class AppManager {
    constructor() {
        this.state = {
            currentPage: 'dashboard',
            theme: 'dark',
            language: 'ar',
            user: null,
            data: {}
        };
        
        this.init();
    }

    async init() {
        this.loadTheme();
        this.loadLanguage();
        this.setupEventListeners();
        await this.loadUserSession();
        await this.navigateTo('dashboard');
        this.startHeartbeat();
    }

    loadTheme() {
        const saved = localStorage.getItem('theme') || 'dark';
        this.state.theme = saved;
        document.documentElement.className = saved === 'dark' ? '' : 'light-theme';
        document.getElementById('themeToggle').innerHTML = 
            `<i class="fas fa-${saved === 'dark' ? 'moon' : 'sun'}"></i>`;
    }

    loadLanguage() {
        const saved = localStorage.getItem('language') || 'ar';
        this.state.language = saved;
        document.documentElement.dir = saved === 'ar' ? 'rtl' : 'ltr';
        document.getElementById('langToggle').innerHTML = 
            `<i class="fas fa-${saved === 'ar' ? 'globe' : 'globe-asia'}"></i>`;
    }

    setupEventListeners() {
        // تبديل الوضع الليلي
        document.getElementById('themeToggle').addEventListener('click', () => {
            const newTheme = this.state.theme === 'dark' ? 'light' : 'dark';
            this.state.theme = newTheme;
            localStorage.setItem('theme', newTheme);
            this.loadTheme();
        });

        // تبديل اللغة
        document.getElementById('langToggle').addEventListener('click', () => {
            const newLang = this.state.language === 'ar' ? 'en' : 'ar';
            this.state.language = newLang;
            localStorage.setItem('language', newLang);
            this.loadLanguage();
            this.navigateTo(this.state.currentPage);
        });

        // التنقل بين الصفحات
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                this.navigateTo(page);
            });
        });
    }

    async loadUserSession() {
        try {
            const token = localStorage.getItem('auth_token');
            if (token) {
                const response = await fetch('/.netlify/functions/api/verify-session', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.state.user = data.user;
                    document.getElementById('userName').textContent = data.user.name || 'المطور';
                } else {
                    localStorage.removeItem('auth_token');
                    this.showLoginModal();
                }
            } else {
                this.showLoginModal();
            }
        } catch (error) {
            console.error('خطأ في التحقق من الجلسة:', error);
            this.showLoginModal();
        }
    }

    showLoginModal() {
        // عرض نموذج تسجيل الدخول
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal">
                <h2>${this.translate('login')}</h2>
                <form id="loginForm">
                    <div class="form-group">
                        <label>${this.translate('email')}</label>
                        <input type="email" id="loginEmail" required placeholder="developer@app.com" />
                    </div>
                    <div class="form-group">
                        <label>${this.translate('password')}</label>
                        <input type="password" id="loginPassword" required placeholder="••••••••" />
                    </div>
                    <div class="modal-actions">
                        <button type="submit" class="btn btn-primary">${this.translate('login')}</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;

            try {
                const response = await fetch('/.netlify/functions/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();
                if (response.ok) {
                    localStorage.setItem('auth_token', data.token);
                    this.state.user = data.user;
                    document.getElementById('userName').textContent = data.user.name || 'المطور';
                    modal.remove();
                    await this.navigateTo('dashboard');
                } else {
                    alert(data.error || 'فشل تسجيل الدخول');
                }
            } catch (error) {
                alert('خطأ في الاتصال بالخادم');
            }
        });
    }

    async navigateTo(page) {
        this.state.currentPage = page;
        
        // تحديث القائمة النشطة
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });

        const content = document.getElementById('content');
        
        switch(page) {
            case 'dashboard':
                await this.renderDashboard(content);
                break;
            case 'devices':
                await this.renderDevices(content);
                break;
            case 'licenses':
                await this.renderLicenses(content);
                break;
            case 'notifications':
                await this.renderNotifications(content);
                break;
            case 'updates':
                await this.renderUpdates(content);
                break;
            case 'logs':
                await this.renderLogs(content);
                break;
            case 'settings':
                await this.renderSettings(content);
                break;
            default:
                content.innerHTML = '<h2>الصفحة غير موجودة</h2>';
        }
    }

    translate(key) {
        const translations = {
            ar: {
                login: 'تسجيل الدخول',
                email: 'البريد الإلكتروني',
                password: 'كلمة المرور',
                dashboard: 'لوحة التحكم',
                devices: 'الأجهزة',
                licenses: 'التراخيص',
                notifications: 'الإشعارات',
                updates: 'التحديثات',
                logs: 'السجلات',
                settings: 'الإعدادات'
            },
            en: {
                login: 'Login',
                email: 'Email',
                password: 'Password',
                dashboard: 'Dashboard',
                devices: 'Devices',
                licenses: 'Licenses',
                notifications: 'Notifications',
                updates: 'Updates',
                logs: 'Logs',
                settings: 'Settings'
            }
        };
        return translations[this.state.language][key] || key;
    }

    // ============================================
    // Dashboard Renderer
    // ============================================
    async renderDashboard(container) {
        const stats = await this.fetchStats();
        
        container.innerHTML = `
            <div class="dashboard-grid">
                <div class="stat-card">
                    <div class="label">${this.translate('devices')}</div>
                    <div class="value">${stats.devices || 0}</div>
                    <div class="change">↑ 12% هذا الشهر</div>
                </div>
                <div class="stat-card">
                    <div class="label">المستخدمين النشطين</div>
                    <div class="value">${stats.activeUsers || 0}</div>
                    <div class="change">↑ 8% هذا الشهر</div>
                </div>
                <div class="stat-card">
                    <div class="label">التراخيص النشطة</div>
                    <div class="value">${stats.activeLicenses || 0}</div>
                    <div class="change">↑ 15% هذا الشهر</div>
                </div>
                <div class="stat-card">
                    <div class="label">الأجهزة المحظورة</div>
                    <div class="value">${stats.bannedDevices || 0}</div>
                    <div class="change danger">↑ 3% هذا الشهر</div>
                </div>
                <div class="stat-card">
                    <div class="label">طلب API</div>
                    <div class="value">${stats.apiCalls || 0}</div>
                    <div class="change">↑ 22% هذا الشهر</div>
                </div>
                <div class="stat-card">
                    <div class="label">الاتصالات الحالية</div>
                    <div class="value">${stats.activeConnections || 0}</div>
                    <div class="change">${stats.activeConnections > 0 ? '🟢 نشط' : '🔴 غير نشط'}</div>
                </div>
            </div>

            <div class="charts-section">
                <div class="chart-container">
                    <h3>نشاط API - آخر 7 أيام</h3>
                    <div class="chart-placeholder" id="apiChart"></div>
                </div>
                <div class="chart-container">
                    <h3>توزيع الأجهزة</h3>
                    <div class="chart-placeholder" id="deviceChart"></div>
                </div>
            </div>

            <div class="chart-container">
                <h3>آخر العمليات</h3>
                <div id="recentActivity">
                    ${this.renderRecentActivity(stats.recentActivity || [])}
                </div>
            </div>
        `;

        this.renderCharts(stats);
    }

    renderRecentActivity(activities) {
        if (!activities.length) return '<p>لا توجد عمليات حديثة</p>';
        
        return activities.map(activity => `
            <div style="padding: 12px 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between;">
                <span>${activity.action}</span>
                <span style="color: var(--text-secondary); font-size: 13px;">${this.formatTime(activity.time)}</span>
            </div>
        `).join('');
    }

    renderCharts(stats) {
        // رسم بياني لـ API
        const apiChart = document.getElementById('apiChart');
        if (apiChart && stats.apiHistory) {
            const max = Math.max(...stats.apiHistory, 1);
            apiChart.innerHTML = stats.apiHistory.map(value => `
                <div class="chart-bar" style="height: ${(value / max) * 250}px;" 
                     title="${value} طلب"></div>
            `).join('');
        }

        // رسم بياني للأجهزة
        const deviceChart = document.getElementById('deviceChart');
        if (deviceChart && stats.deviceDistribution) {
            const max = Math.max(...Object.values(stats.deviceDistribution), 1);
            deviceChart.innerHTML = Object.entries(stats.deviceDistribution).map(([key, value]) => `
                <div style="flex:1; text-align:center;">
                    <div class="chart-bar" style="height: ${(value / max) * 250}px; background: var(--accent-secondary);"></div>
                    <span style="font-size:12px; color:var(--text-secondary);">${key}</span>
                </div>
            `).join('');
        }
    }

    // ============================================
    // Devices Page
    // ============================================
    async renderDevices(container) {
        const devices = await this.fetchDevices();
        
        container.innerHTML = `
            <div class="table-container">
                <div class="table-header">
                    <h2>${this.translate('devices')}</h2>
                    <div class="filters">
                        <input type="text" placeholder="بحث عن جهاز..." id="deviceSearch" />
                        <select id="deviceStatus">
                            <option value="all">الكل</option>
                            <option value="active">نشط</option>
                            <option value="banned">محظور</option>
                        </select>
                        <button class="btn btn-primary btn-sm" onclick="app.refreshDevices()">
                            <i class="fas fa-sync"></i>
                        </button>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>الجهاز</th>
                            <th>Android</th>
                            <th>الإصدار</th>
                            <th>آخر اتصال</th>
                            <th>IP</th>
                            <th>البلد</th>
                            <th>الحالة</th>
                            <th>الإجراءات</th>
                        </tr>
                    </thead>
                    <tbody id="devicesTable">
                        ${devices.map(device => this.renderDeviceRow(device)).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // إضافة مستمعي الأحداث
        document.getElementById('deviceSearch').addEventListener('input', () => this.filterDevices());
        document.getElementById('deviceStatus').addEventListener('change', () => this.filterDevices());
    }

    renderDeviceRow(device) {
        const status = device.banned ? 'banned' : 'active';
        return `
            <tr data-device-id="${device.id}">
                <td><strong>${device.name || 'غير معروف'}</strong></td>
                <td>${device.android_version || 'N/A'}</td>
                <td>v${device.app_version || '1.0'}</td>
                <td>${this.formatTime(device.last_seen)}</td>
                <td>${device.ip || 'N/A'}</td>
                <td>${device.country || 'غير معروف'}</td>
                <td><span class="status-badge ${status}">${status === 'active' ? 'نشط' : 'محظور'}</span></td>
                <td>
                    <button class="btn btn-danger btn-sm" onclick="app.toggleDeviceBan('${device.id}')">
                        <i class="fas fa-${device.banned ? 'unlock' : 'ban'}"></i>
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="app.resetDevice('${device.id}')">
                        <i class="fas fa-sync"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    // ============================================
    // Licenses Page
    // ============================================
    async renderLicenses(container) {
        const licenses = await this.fetchLicenses();
        
        container.innerHTML = `
            <div class="table-container">
                <div class="table-header">
                    <h2>${this.translate('licenses')}</h2>
                    <div>
                        <button class="btn btn-success" onclick="app.showCreateLicenseModal()">
                            <i class="fas fa-plus"></i> إنشاء ترخيص
                        </button>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>الكود</th>
                            <th>المستخدم</th>
                            <th>الأجهزة</th>
                            <th>الحد الأقصى</th>
                            <th>تاريخ البدء</th>
                            <th>تاريخ الانتهاء</th>
                            <th>الحالة</th>
                            <th>الإجراءات</th>
                        </tr>
                    </thead>
                    <tbody id="licensesTable">
                        ${licenses.map(license => this.renderLicenseRow(license)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderLicenseRow(license) {
        const status = this.getLicenseStatus(license);
        return `
            <tr>
                <td><code style="background:var(--bg-primary);padding:4px 8px;border-radius:4px;">${license.code}</code></td>
                <td>${license.user_name || 'غير محدد'}</td>
                <td>${license.device_count || 0}</td>
                <td>${license.max_devices || 1}</td>
                <td>${this.formatDate(license.start_date)}</td>
                <td>${this.formatDate(license.end_date)}</td>
                <td><span class="status-badge ${status}">${this.translateStatus(status)}</span></td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="app.editLicense('${license.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="app.deleteLicense('${license.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    // ============================================
    // Notifications Page
    // ============================================
    async renderNotifications(container) {
        container.innerHTML = `
            <div style="max-width: 800px; margin: 0 auto;">
                <h2 style="margin-bottom: 24px;">${this.translate('notifications')}</h2>
                
                <div style="background: var(--bg-card); padding: 24px; border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: 24px;">
                    <h3 style="margin-bottom: 16px;">إرسال إشعار جديد</h3>
                    <form id="notificationForm">
                        <div class="form-group">
                            <label>نوع الإشعار</label>
                            <select id="notificationType">
                                <option value="all">للجميع</option>
                                <option value="device">لجهاز محدد</option>
                                <option value="popup">نافذة منبثقة</option>
                                <option value="force">رسالة إجبارية</option>
                            </select>
                        </div>
                        <div class="form-group" id="deviceSelectGroup" style="display:none;">
                            <label>اختر الجهاز</label>
                            <select id="targetDevice"></select>
                        </div>
                        <div class="form-group">
                            <label>العنوان</label>
                            <input type="text" id="notificationTitle" required placeholder="عنوان الإشعار" />
                        </div>
                        <div class="form-group">
                            <label>الرسالة</label>
                            <textarea id="notificationMessage" required placeholder="محتوى الإشعار"></textarea>
                        </div>
                        <button type="submit" class="btn btn-primary">إرسال الإشعار</button>
                    </form>
                </div>

                <div style="background: var(--bg-card); border-radius: var(--radius); border: 1px solid var(--border); padding: 24px;">
                    <h3 style="margin-bottom: 16px;">آخر الإشعارات</h3>
                    <div id="recentNotifications">
                        ${await this.fetchRecentNotifications()}
                    </div>
                </div>
            </div>
        `;

        // إعداد نموذج الإشعارات
        document.getElementById('notificationType').addEventListener('change', function() {
            document.getElementById('deviceSelectGroup').style.display = this.value === 'device' ? 'block' : 'none';
            if (this.value === 'device') {
                app.loadDeviceSelect();
            }
        });

        document.getElementById('notificationForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.sendNotification();
        });
    }

    // ============================================
    // Updates Page
    // ============================================
    async renderUpdates(container) {
        const currentConfig = await this.fetchConfig();
        
        container.innerHTML = `
            <div style="max-width: 800px; margin: 0 auto;">
                <h2 style="margin-bottom: 24px;">${this.translate('updates')}</h2>
                
                <div style="background: var(--bg-card); padding: 24px; border-radius: var(--radius); border: 1px solid var(--border);">
                    <form id="updateForm">
                        <div class="form-group">
                            <label>الإصدار الأدنى المطلوب</label>
                            <input type="text" id="minVersion" value="${currentConfig.min_version || '1.0.0'}" 
                                   placeholder="مثال: 2.0.0" />
                        </div>
                        <div class="form-group">
                            <label>رابط التحديث</label>
                            <input type="url" id="updateUrl" value="${currentConfig.update_url || ''}" 
                                   placeholder="https://your-app.com/update.apk" />
                        </div>
                        <div class="form-group">
                            <label>رسالة التحديث</label>
                            <textarea id="updateMessage" rows="3" placeholder="اكتب رسالة التحديث هنا">${currentConfig.update_message || ''}</textarea>
                        </div>
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="forceUpdate" ${currentConfig.force_update ? 'checked' : ''} />
                                إجبار المستخدم على التحديث
                            </label>
                        </div>
                        <button type="submit" class="btn btn-primary">تحديث الإعدادات</button>
                    </form>
                </div>
            </div>
        `;

        document.getElementById('updateForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveUpdateConfig();
        });
    }

    // ============================================
    // Logs Page
    // ============================================
    async renderLogs(container) {
        const logs = await this.fetchLogs();
        
        container.innerHTML = `
            <div class="table-container">
                <div class="table-header">
                    <h2>${this.translate('logs')}</h2>
                    <div class="filters">
                        <select id="logType">
                            <option value="all">الكل</option>
                            <option value="error">أخطاء</option>
                            <option value="login">تسجيل دخول</option>
                            <option value="license">تراخيص</option>
                            <option value="api">API</option>
                        </select>
                        <button class="btn btn-primary btn-sm" onclick="app.refreshLogs()">
                            <i class="fas fa-sync"></i>
                        </button>
                    </div>
                </div>
                <div id="logsContainer">
                    ${logs.map(log => this.renderLogEntry(log)).join('')}
                </div>
            </div>
        `;

        document.getElementById('logType').addEventListener('change', () => this.filterLogs());
    }

    renderLogEntry(log) {
        const severityColors = {
            error: 'var(--danger)',
            warning: 'var(--warning)',
            info: 'var(--accent-primary)',
            success: 'var(--success)'
        };

        return `
            <div style="padding: 12px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${severityColors[log.severity] || 'var(--text-secondary)'}; margin-left: 8px;"></span>
                    <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">${this.formatTime(log.timestamp)}</span>
                    <span>${log.message}</span>
                </div>
                <span style="color: var(--text-secondary); font-size: 12px;">${log.source || 'system'}</span>
            </div>
        `;
    }

    // ============================================
    // Settings Page
    // ============================================
    async renderSettings(container) {
        const settings = await this.fetchSettings();
        
        container.innerHTML = `
            <div style="max-width: 800px; margin: 0 auto;">
                <h2 style="margin-bottom: 24px;">${this.translate('settings')}</h2>
                
                <div style="background: var(--bg-card); padding: 24px; border-radius: var(--radius); border: 1px solid var(--border);">
                    <form id="settingsForm">
                        <div class="form-group">
                            <label>اسم التطبيق</label>
                            <input type="text" id="appName" value="${settings.app_name || 'SmartApp'}" />
                        </div>
                        <div class="form-group">
                            <label>وضع الصيانة</label>
                            <select id="maintenanceMode">
                                <option value="false" ${!settings.maintenance ? 'selected' : ''}>معطل</option>
                                <option value="true" ${settings.maintenance ? 'selected' : ''}>مفعل</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>معدل نبض القلب (ثانية)</label>
                            <input type="number" id="heartbeatInterval" value="${settings.heartbeat_interval || 60}" min="30" max="300" />
                        </div>
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="debugMode" ${settings.debug_mode ? 'checked' : ''} />
                                وضع التصحيح (للمطور فقط)
                            </label>
                        </div>
                        <button type="submit" class="btn btn-primary">حفظ الإعدادات</button>
                    </form>
                </div>
            </div>
        `;

        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveSettings();
        });
    }

    // ============================================
    // API Functions
    // ============================================
    async fetchStats() {
        try {
            const response = await this.apiRequest('/dashboard');
            return await response.json();
        } catch (error) {
            console.error('خطأ في جلب الإحصائيات:', error);
            return {
                devices: 0,
                activeUsers: 0,
                activeLicenses: 0,
                bannedDevices: 0,
                apiCalls: 0,
                activeConnections: 0,
                apiHistory: [10, 25, 18, 40, 35, 50, 45],
                deviceDistribution: { 'Android 12': 40, 'Android 13': 35, 'Android 11': 25 },
                recentActivity: []
            };
        }
    }

    async fetchDevices() {
        try {
            const response = await this.apiRequest('/devices');
            return await response.json();
        } catch (error) {
            console.error('خطأ في جلب الأجهزة:', error);
            return [];
        }
    }

    async fetchLicenses() {
        try {
            const response = await this.apiRequest('/licenses');
            return await response.json();
        } catch (error) {
            console.error('خطأ في جلب التراخيص:', error);
            return [];
        }
    }

    async fetchConfig() {
        try {
            const response = await this.apiRequest('/config');
            return await response.json();
        } catch (error) {
            console.error('خطأ في جلب الإعدادات:', error);
            return {};
        }
    }

    async fetchLogs() {
        try {
            const response = await this.apiRequest('/logs');
            return await response.json();
        } catch (error) {
            console.error('خطأ في جلب السجلات:', error);
            return [];
        }
    }

    async fetchSettings() {
        try {
            const response = await this.apiRequest('/settings');
            return await response.json();
        } catch (error) {
            console.error('خطأ في جلب الإعدادات:', error);
            return {};
        }
    }

    async fetchRecentNotifications() {
        try {
            const response = await this.apiRequest('/notifications');
            const data = await response.json();
            return data.map(n => `
                <div style="padding: 12px 0; border-bottom: 1px solid var(--border);">
                    <div style="font-weight: 600;">${n.title}</div>
                    <div style="color: var(--text-secondary); font-size: 14px;">${n.message}</div>
                    <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px;">${this.formatTime(n.created_at)}</div>
                </div>
            `).join('');
        } catch (error) {
            return '<p style="color:var(--text-secondary);">لا توجد إشعارات سابقة</p>';
        }
    }

    async apiRequest(endpoint, method = 'GET', body = null) {
        const token = localStorage.getItem('auth_token');
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`/.netlify/functions/api${endpoint}`, options);
        
        if (response.status === 401) {
            this.showLoginModal();
            throw new Error('Unauthorized');
        }

        return response;
    }

    // ============================================
    // Utility Functions
    // ============================================
    formatTime(timestamp) {
        if (!timestamp) return 'غير معروف';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        
        if (diff < 60) return 'الآن';
        if (diff < 3600) return `${Math.floor(diff / 60)} دقيقة`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} ساعة`;
        if (diff < 604800) return `${Math.floor(diff / 86400)} يوم`;
        return date.toLocaleDateString('ar-EG');
    }

    formatDate(date) {
        if (!date) return 'غير محدد';
        return new Date(date).toLocaleDateString('ar-EG');
    }

    getLicenseStatus(license) {
        if (!license) return 'inactive';
        const now = new Date();
        const end = new Date(license.end_date);
        const start = new Date(license.start_date);
        
        if (now < start) return 'pending';
        if (now > end) return 'inactive';
        return 'active';
    }

    translateStatus(status) {
        const map = {
            active: 'نشط',
            inactive: 'منتهي',
            pending: 'قيد الانتظار',
            banned: 'محظور'
        };
        return map[status] || status;
    }

    // ============================================
    // Action Functions
    // ============================================
    async toggleDeviceBan(deviceId) {
        if (!confirm('هل أنت متأكد من تغيير حالة هذا الجهاز؟')) return;
        
        try {
            await this.apiRequest('/devices/toggle-ban', 'POST', { deviceId });
            this.refreshDevices();
        } catch (error) {
            alert('حدث خطأ أثناء تغيير حالة الجهاز');
        }
    }

    async resetDevice(deviceId) {
        if (!confirm('سيتم إعادة تعيين هذا الجهاز بالكامل. هل أنت متأكد؟')) return;
        
        try {
            await this.apiRequest('/devices/reset', 'POST', { deviceId });
            this.refreshDevices();
        } catch (error) {
            alert('حدث خطأ أثناء إعادة تعيين الجهاز');
        }
    }

    async deleteLicense(licenseId) {
        if (!confirm('سيتم حذف هذا الترخيص بشكل دائم. هل أنت متأكد؟')) return;
        
        try {
            await this.apiRequest('/licenses/delete', 'POST', { licenseId });
            this.refreshLicenses();
        } catch (error) {
            alert('حدث خطأ أثناء حذف الترخيص');
        }
    }

    async sendNotification() {
        const type = document.getElementById('notificationType').value;
        const title = document.getElementById('notificationTitle').value;
        const message = document.getElementById('notificationMessage').value;
        const deviceId = document.getElementById('targetDevice')?.value;

        if (!title || !message) {
            alert('الرجاء إدخال عنوان ورسالة الإشعار');
            return;
        }

        try {
            await this.apiRequest('/notification/send', 'POST', {
                type,
                title,
                message,
                deviceId
            });
            alert('تم إرسال الإشعار بنجاح');
            document.getElementById('notificationForm').reset();
            this.refreshNotifications();
        } catch (error) {
            alert('حدث خطأ أثناء إرسال الإشعار');
        }
    }

    async saveUpdateConfig() {
        const minVersion = document.getElementById('minVersion').value;
        const updateUrl = document.getElementById('updateUrl').value;
        const updateMessage = document.getElementById('updateMessage').value;
        const forceUpdate = document.getElementById('forceUpdate').checked;

        try {
            await this.apiRequest('/config/update', 'POST', {
                min_version: minVersion,
                update_url: updateUrl,
                update_message: updateMessage,
                force_update: forceUpdate
            });
            alert('تم حفظ إعدادات التحديث بنجاح');
        } catch (error) {
            alert('حدث خطأ أثناء حفظ الإعدادات');
        }
    }

    async saveSettings() {
        const appName = document.getElementById('appName').value;
        const maintenance = document.getElementById('maintenanceMode').value === 'true';
        const heartbeatInterval = parseInt(document.getElementById('heartbeatInterval').value);
        const debugMode = document.getElementById('debugMode').checked;

        try {
            await this.apiRequest('/settings/save', 'POST', {
                app_name: appName,
                maintenance,
                heartbeat_interval: heartbeatInterval,
                debug_mode: debugMode
            });
            alert('تم حفظ الإعدادات بنجاح');
        } catch (error) {
            alert('حدث خطأ أثناء حفظ الإعدادات');
        }
    }

    // ============================================
    // Refresh Functions
    // ============================================
    refreshDevices() {
        this.navigateTo('devices');
    }

    refreshLicenses() {
        this.navigateTo('licenses');
    }

    refreshLogs() {
        this.navigateTo('logs');
    }

    refreshNotifications() {
        this.navigateTo('notifications');
    }

    startHeartbeat() {
        // إرسال نبض القلب كل 60 ثانية
        setInterval(async () => {
            try {
                await this.apiRequest('/heartbeat', 'POST');
            } catch (error) {
                console.error('خطأ في نبض القلب:', error);
            }
        }, 60000);
    }
}

// ============================================
// تهيئة التطبيق
// ============================================
let app = null;
document.addEventListener('DOMContentLoaded', () => {
    app = new AppManager();
    window.app = app;
});