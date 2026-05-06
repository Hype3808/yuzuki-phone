/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
// 主屏幕
import { APPS, PHONE_CONFIG } from '../config/apps.js'; // 🔥🔥🔥 这一行必须改！

export class HomeScreen {
    constructor(phoneShell, apps) {
        this.phoneShell = phoneShell;
        this.apps = apps || APPS; // 🔥 修复：确保 apps 有默认值
        this._homeRenderVersion = 0;
        
        // 🔥 修复：确保 window.VirtualPhone 存在
        const storage = window.VirtualPhone?.storage;
        if (storage) {
            this.wallpaper = storage.get('phone-wallpaper') || PHONE_CONFIG.defaultWallpaper;
        } else {
            this.wallpaper = PHONE_CONFIG.defaultWallpaper;
        }
    }

    // 🔥 新增：判断当前是否为主屏幕
    isHomeScreenVisible() {
        const homeScreenElement = this.phoneShell.screen?.querySelector('.home-screen');
        return !!homeScreenElement;
    }
    
    render(options = {}) {
        const forceDomRefresh = !!options.forceDomRefresh;
        if (forceDomRefresh) {
            this._homeRenderVersion += 1;
        }
        const renderKeyAttr = forceDomRefresh ? ` data-render-key="${this._homeRenderVersion}"` : '';

        // 获取自定义壁纸
        let customWallpaper = null;
        try {
            if (window.VirtualPhone?.imageManager) {
                customWallpaper = window.VirtualPhone.imageManager.getWallpaper();
            }
        } catch (e) {
            console.warn('获取壁纸失败:', e);
        }

        // 只有自定义壁纸时才设置内联样式，否则使用CSS中的玻璃效果
        const wallpaperStyle = customWallpaper
            ? `background-image: url('${customWallpaper}'); background-size: cover; background-position: center;`
            : '';

        const html = `
            <div class="home-screen home-layout-${this.getHomeLayout()}"${renderKeyAttr}>
                <div class="wallpaper" style="${wallpaperStyle}"></div>

                ${this.getHomeLayout() === 'cards' ? this.renderCardLayout() : this.renderIconLayout()}

                <div class="dock">
                    ${this.renderDock()}
                </div>
            </div>
        `;

        this.phoneShell.setContent(html);
        this.bindEvents();
    }

    getHomeLayout() {
        const layout = String(window.VirtualPhone?.storage?.get('phone-home-layout') || 'icons');
        return layout === 'cards' ? 'cards' : 'icons';
    }

    renderIconLayout() {
        return `
            <div class="home-time">
                <div class="time-large">${this.getCurrentTime()}</div>
                <div class="date">${this.getCurrentDate()}</div>
            </div>
            <div class="app-grid">
                ${this.apps.map(app => this.renderAppIcon(app)).join('')}
            </div>
        `;
    }

    renderCardLayout() {
        return `
            <div class="home-dashboard">
                <section class="home-time-card">
                    <div class="time-large">${this.getCurrentTime()}</div>
                    <div class="date">${this.getCurrentDate()}</div>
                </section>

                <div class="home-top-grid">
                    ${this.renderMusicCard()}
                    ${this.renderQuickAppsCard()}
                </div>

                ${this.renderDiaryCard()}

                <div class="home-feature-grid">
                    ${this.renderFeatureCard('mofo')}
                    ${this.renderFeatureCard('games')}
                </div>

                ${this.renderSettingsCard()}
            </div>
        `;
    }

    getAppById(appId) {
        return this.apps.find(app => app.id === appId) || null;
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _getCustomIcon(appId) {
        try {
            if (window.VirtualPhone?.imageManager) {
                return window.VirtualPhone.imageManager.getAppIcon(appId);
            }
        } catch (e) {
            console.warn('获取APP图标失败:', e);
        }
        return null;
    }

    renderAppGlyph(app, className = 'home-widget-icon') {
        if (!app) return '';
        const customIcon = this._getCustomIcon(app.id);
        if (customIcon) {
            return `<span class="${className} custom-icon" style="background-image:url('${customIcon}');"></span>`;
        }
        return `<span class="${className}" style="--app-color:${app.color};">${this._escapeHtml(app.icon)}</span>`;
    }

    renderAppBadge(app) {
        return app?.badge > 0 ? `<span class="app-badge">${app.badge}</span>` : '';
    }

    renderMusicCard() {
        const app = this.getAppById('music');
        if (!app) return '';
        return `
            <section class="app-icon home-widget-card home-music-card" data-app="${app.id}" style="--app-color:${app.color};">
                <div class="home-card-main">
                    ${this.renderAppGlyph(app, 'home-widget-icon')}
                    <div class="home-card-title">${this._escapeHtml(app.name)}</div>
                </div>
                <div class="home-music-controls" aria-hidden="true">
                    <span>⏮</span>
                    <span>⏸</span>
                    <span>⏭</span>
                </div>
                ${this.renderAppBadge(app)}
            </section>
        `;
    }

    renderQuickAppsCard() {
        const quickIds = ['wechat', 'weibo', 'honey', 'phone'];
        const quickApps = quickIds.map(id => this.getAppById(id)).filter(Boolean);
        return `
            <section class="home-quick-card">
                ${quickApps.map(app => `
                    <div class="app-icon home-mini-app" data-app="${app.id}" style="--app-color:${app.color};">
                        ${this.renderAppGlyph(app, 'home-mini-icon')}
                        ${this.renderAppBadge(app)}
                        <div class="home-mini-name">${this._escapeHtml(app.name)}</div>
                    </div>
                `).join('')}
            </section>
        `;
    }

    renderDiaryCard() {
        const app = this.getAppById('diary');
        if (!app) return '';
        return `
            <section class="app-icon home-diary-card" data-app="${app.id}" style="--app-color:${app.color};">
                ${this.renderAppGlyph(app, 'home-diary-icon')}
                <div class="home-diary-copy">
                    <div class="home-card-title">${this._escapeHtml(app.name)}</div>
                    <div class="home-card-desc">记录今天的片段、心情和那些没说出口的话。</div>
                </div>
                ${this.renderAppBadge(app)}
            </section>
        `;
    }

    renderFeatureCard(appId) {
        const app = this.getAppById(appId);
        if (!app) return '';
        return `
            <section class="app-icon home-feature-card" data-app="${app.id}" style="--app-color:${app.color};">
                ${this.renderAppGlyph(app, 'home-feature-icon')}
                ${this.renderAppBadge(app)}
                <div class="home-card-title">${this._escapeHtml(app.name)}</div>
            </section>
        `;
    }

    renderSettingsCard() {
        const app = this.getAppById('settings');
        if (!app) return '';
        return `
            <section class="app-icon home-settings-card" data-app="${app.id}" style="--app-color:${app.color};">
                <div class="home-settings-left">
                    ${this.renderAppGlyph(app, 'home-settings-icon')}
                    <div class="home-settings-title">${this._escapeHtml(app.name)}</div>
                </div>
                <div class="home-settings-chevron">›</div>
                ${this.renderAppBadge(app)}
            </section>
        `;
    }

    // 🔥 获取快捷栏配置
    getDockApps() {
        const storage = window.VirtualPhone?.storage;
        let dockAppIds = ['wechat', 'weibo', 'phone', 'settings']; // 默认4个

        if (storage) {
            const saved = storage.get('dock-apps');
            if (saved) {
                try {
                    dockAppIds = JSON.parse(saved);
                } catch (e) {
                    console.warn('解析dock配置失败:', e);
                }
            }
        }

        // 根据ID获取完整的app信息
        return dockAppIds.map(id => this.apps.find(app => app.id === id)).filter(Boolean);
    }

    // 🔥 渲染底部快捷栏
    renderDock() {
        const dockApps = this.getDockApps();

        return dockApps.map(app => {
            // 获取自定义图标
            const customIcon = this._getCustomIcon(app.id);

            const iconStyle = customIcon
                ? `background-image: url('${customIcon}'); background-size: contain; background-position: center; background-repeat: no-repeat;`
                : '';

            const customClass = customIcon ? 'custom-icon' : '';
            const iconContent = customIcon ? '' : app.icon;

            return `
                <div class="dock-app ${customClass}" data-app="${app.id}" style="${iconStyle}">
                    ${iconContent}
                </div>
            `;
        }).join('');
    }
    
    renderAppIcon(app) {
        const badge = app.badge > 0 ? `<span class="app-badge">${app.badge}</span>` : '';
        
        // 获取自定义图标
        let customIcon = null;
        try {
            if (window.VirtualPhone?.imageManager) {
                customIcon = window.VirtualPhone.imageManager.getAppIcon(app.id);
            }
        } catch (e) {
            console.warn('获取APP图标失败:', e);
        }
        
        // 如果有自定义图标，用背景图；否则用emoji
        const iconStyle = customIcon
            ? `background-image: url('${customIcon}'); background-size: contain; background-position: center; background-repeat: no-repeat;`
            : '';

        const iconContent = customIcon ? '' : `<span class="app-icon-emoji">${app.icon}</span>`;

        // 自定义图标添加特殊class，用于移除默认背景效果
        const customClass = customIcon ? 'custom-icon' : '';

        return `
            <div class="app-icon" data-app="${app.id}" style="--app-color: ${app.color}">
                <div class="app-icon-bg ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${badge}
                <div class="app-name">${app.name}</div>
            </div>
        `;
    }
    
    bindEvents() {
        const icons = this.phoneShell.screen.querySelectorAll('.app-icon, .dock-app');
        icons.forEach(icon => {
            icon.onclick = (e) => {
                e.stopPropagation();
                const appId = icon.dataset.app;
                this.openApp(appId);
            };
        });

        // 监听壁纸更新
        if (!this._wallpaperEventBound) {
            this._wallpaperEventBound = true;
            window.addEventListener('phone:updateWallpaper', (e) => {
                this.render({ forceDomRefresh: true });
            });
        }

        // 监听APP图标更新
        if (!this._appIconEventBound) {
            this._appIconEventBound = true;
            window.addEventListener('phone:updateAppIcon', () => {
                this.render({ forceDomRefresh: true });
            });
        }
    }
    
    openApp(appId) {
        window.dispatchEvent(new CustomEvent('phone:openApp', { 
            detail: { appId } 
        }));
    }
    
    getCurrentTime() {
        const timeManager = window.VirtualPhone?.timeManager;
        
        if (timeManager) {
            const storyTime = timeManager.getCurrentStoryTime();
            return storyTime?.time;
        }
        
        // 降级方案
        const now = new Date();
        return now.toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
    }
    
    getCurrentDate() {
    const timeManager = window.VirtualPhone?.timeManager;
    
    if (timeManager) {
        const storyTime = timeManager.getCurrentStoryTime();
        const dateParts = storyTime?.date?.match(/(\d+)年(\d+)月(\d+)日/);
        if (dateParts) {
            const year = parseInt(dateParts[1]);
            const month = parseInt(dateParts[2]);
            const day = parseInt(dateParts[3]);
            return `${year}年${month}月${day}日 ${storyTime.weekday}`;
        }
    }
    
    // 降级方案
    const now = new Date();
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const weekday = weekdays[now.getDay()];
    return `${year}年${month}月${day}日 ${weekday}`;
}

}
