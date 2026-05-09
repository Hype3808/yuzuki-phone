/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 * ======================================================== */

import { GamesData } from './games-data.js';
import { GamesView } from './games-view.js';
import { WechatData } from '../wechat/wechat-data.js';

export class GamesApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.gamesData = new GamesData(storage);
        this.gamesView = new GamesView(this);
        this.currentView = 'lobby';

        window.addEventListener('phone:swipeBack', () => this.handleSwipeBack());
    }

    getWechatData() {
        if (window.VirtualPhone?.cachedWechatData) return window.VirtualPhone.cachedWechatData;
        if (window.VirtualPhone?.wechatApp?.wechatData) return window.VirtualPhone.wechatApp.wechatData;
        if (!this._wechatData) {
            this._wechatData = new WechatData(this.storage);
        }
        return this._wechatData;
    }

    resolvePlayerAvatar(player = {}) {
        const wechatData = this.getWechatData();
        if (!wechatData) return '';
        if (player.id === 'user') {
            return wechatData.getUserInfo?.()?.avatar || '';
        }
        const contact = wechatData.getContactByName?.(player.name);
        return contact?.avatar || '';
    }

    renderPlayerAvatar(player = {}) {
        const wechatApp = window.VirtualPhone?.wechatApp;
        const avatar = this.resolvePlayerAvatar(player);
        const name = String(player?.name || '').trim();
        if (wechatApp && typeof wechatApp.renderAvatar === 'function') {
            return wechatApp.renderAvatar(avatar, '👤', name);
        }

        if (avatar && /^(data:image\/|https?:\/\/|\/|\.\/|backgrounds\/|apps\/)/i.test(String(avatar))) {
            return `<img src="${this._escapeAttr(avatar)}" alt="${this._escapeAttr(name)}">`;
        }

        const initial = Array.from(name)[0] || '人';
        return `<span>${this._escapeHtml(initial)}</span>`;
    }

    render() {
        this.applyPhoneChromeTheme();
        this.currentView = 'lobby';
        this.gamesView.renderLobby();
    }

    openPoker() {
        this.applyPhoneChromeTheme();
        this.currentView = 'lobby';
        this.gamesView.openPokerSetupOverlay();
    }

    startPokerGame(playerCount) {
        this.applyPhoneChromeTheme();
        this.gamesData.startPokerGame(playerCount);
        this.currentView = 'poker';
        this.gamesView.renderPoker();
    }

    backToLobby() {
        this.applyPhoneChromeTheme();
        this.currentView = 'lobby';
        this.gamesView.renderLobby();
    }

    applyPhoneChromeTheme() {
        document.querySelectorAll('.phone-body-panel-games').forEach(el => el.classList.remove('phone-body-panel-games'));
        const panel = document.querySelector('.phone-body-panel');
        panel?.classList.add('phone-body-panel-games');
    }

    removePhoneChromeTheme() {
        const panel = document.querySelector('.phone-body-panel');
        panel?.classList.remove('phone-body-panel-games');
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _escapeAttr(text) {
        return this._escapeHtml(text);
    }

    handleSwipeBack() {
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView || !currentView.querySelector('.games-app')) return;

        if (this.currentView === 'poker') {
            this.backToLobby();
        } else {
            this.removePhoneChromeTheme();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }
}
