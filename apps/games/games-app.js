/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  游戏大厅入口
 * ======================================================== */

import { PokerApp } from './poker/poker-app.js';
import { Game2048Data } from './game2048/game2048-data.js';
import { Game2048View } from './game2048/game2048-view.js';
import { CatboxData } from './catbox/catbox-data.js';
import { CatboxView } from './catbox/catbox-view.js';

export class GamesApp extends PokerApp {
    constructor(phoneShell, storage) {
        super(phoneShell, storage);
        this.game2048Data = new Game2048Data(storage);
        this.game2048View = new Game2048View(this);
        this.catboxData = new CatboxData(storage);
        this.catboxView = new CatboxView(this);
    }

    open2048() {
        this.applyPhoneChromeTheme();
        this.currentView = 'game2048';
        this.game2048View.render();
    }

    move2048(direction) {
        const result = this.game2048Data.move(direction);
        if (result.moved) this.game2048View.render();
    }

    reset2048() {
        this.game2048Data.reset();
        this.game2048View.render();
    }

    openCatbox() {
        this.applyPhoneChromeTheme();
        this.currentView = 'catbox';
        this.catboxView.resetHudCollapsed?.();
        this.catboxView.render();
    }

    randomCatboxCat() {
        this.catboxData.randomCat();
        this.catboxView.render();
    }

    adoptCatboxCat(name, gender) {
        if (!this.catboxData.getState().draftCatId) {
            this.phoneShell?.showNotification?.('猫盒', '请先随机一只小猫', '🐾');
            return;
        }
        this.catboxData.adoptCat(name, gender);
        this.catboxView.render();
    }

    performCatboxAction(action) {
        this.catboxData.performCare(action);
        this.catboxView.render();
    }

    useCatboxItem(itemId) {
        this.catboxData.useItem(itemId);
        this.catboxView.render();
    }

    buyCatboxItem(itemId) {
        this.catboxData.buyItem(itemId);
        this.catboxView.render();
    }

    getCatboxCoAdoptTargets() {
        const wechatData = this.getWechatData?.();
        const chats = wechatData?.getChatList?.() || [];
        const contacts = wechatData?.getContacts?.() || [];
        const byName = new Map();
        chats
            .filter(chat => chat && chat.type !== 'group' && String(chat.name || '').trim())
            .forEach(chat => {
                byName.set(String(chat.name || '').trim(), {
                    chatId: String(chat.id || '').trim(),
                    name: String(chat.name || '').trim(),
                    avatar: chat.avatar || ''
                });
            });
        contacts
            .filter(contact => contact && String(contact.name || '').trim())
            .forEach(contact => {
                const name = String(contact.name || '').trim();
                if (byName.has(name)) return;
                const chat = wechatData.getChatByContactId?.(contact.id)
                    || chats.find(item => item?.type !== 'group' && String(item.name || '').trim() === name);
                byName.set(name, {
                    chatId: String(chat?.id || `contact:${contact.id || name}`).trim(),
                    contactId: contact.id || '',
                    name,
                    avatar: this.resolveContactAvatar?.(contact, wechatData) || contact.avatar || ''
                });
            });
        return Array.from(byName.values()).filter(item => item.chatId && item.name);
    }

    inviteCatboxCoAdopt(chatId) {
        const wechatData = this.getWechatData?.();
        if (!wechatData) return;
        const rawId = String(chatId || '').trim();
        let chat = wechatData.getChat?.(rawId);
        if (!chat && rawId.startsWith('contact:')) {
            const contactId = rawId.slice('contact:'.length);
            const contact = wechatData.getContact?.(contactId);
            if (contact) {
                chat = wechatData.createChat?.({
                    id: `chat_${contact.id || Date.now()}`,
                    contactId: contact.id,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar || ''
                });
            }
        }
        if (!chat || chat.type === 'group') return;
        const invite = this.catboxData.createCoAdoptInvite({
            chatId: chat.id,
            name: chat.name
        });
        if (!invite) return;
        const userInfo = wechatData.getUserInfo?.() || {};
        const state = this.catboxData.getState();
        wechatData.addMessage(chat.id, {
            from: 'me',
            type: 'text',
            content: `[猫盒共养邀请] 想邀请你一起照顾「${state.catName}」。愿意的话请回复 [同意收养]，不愿意请回复 [拒绝收养]。`,
            avatar: userInfo.avatar || ''
        });
        chat.lastMessage = '[猫盒共养邀请]';
        chat.timestamp = Date.now();
        wechatData.saveData?.();
        this._syncWechatHomeBadge?.(wechatData);
        this.phoneShell?.showNotification?.('猫盒', `已邀请${chat.name}共同收养`, '🐱');
        this.catboxView.render();
    }

    nextCatboxBackground() {
        this.catboxData.nextBackground();
        this.catboxView.render();
    }

    resetCatbox() {
        this.catboxData.resetAdoption();
        this.catboxView.render();
    }

    backToLobby() {
        this.game2048View?.destroy?.();
        this.catboxView?.destroy?.();
        super.backToLobby();
    }

    handleSwipeBack() {
        if (this.currentView === 'game2048' || this.currentView === 'catbox') {
            this.backToLobby();
            return;
        }
        super.handleSwipeBack();
    }
}
