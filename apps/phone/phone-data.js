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
// ========================================
// 通话记录数据层
// ========================================

export class PhoneCallData {
    constructor(storage) {
        this.storage = storage;
        this._callHistory = null; // Lazy-loaded
        this._contacts = null;
    }

    // 获取通话记录（lazy load）
    getCallHistory() {
        if (!this._callHistory) {
            const saved = this.storage.get('phone_call_history', null);
            if (saved) {
                try {
                    this._callHistory = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析通话记录失败:', e);
                    this._callHistory = [];
                }
            } else {
                this._callHistory = [];
            }
        }
        return this._callHistory;
    }

    // 添加通话记录
    // record: { id, caller, time, date, weekday, duration(秒), status('missed'|'answered'|'rejected'), transcript[] }
    addCallRecord(record) {
        const history = this.getCallHistory();
        history.push(record);
        this.saveCallHistory();
    }

    // 删除通话记录
    deleteCallRecord(id) {
        const history = this.getCallHistory();
        const idx = history.findIndex(r => r.id === id);
        if (idx !== -1) {
            history.splice(idx, 1);
            this.saveCallHistory();
            return true;
        }
        return false;
    }

    // 保存通话记录
    saveCallHistory() {
        if (this._callHistory) {
            this.storage.set('phone_call_history', this._callHistory);
        }
    }

    getContacts() {
        if (!this._contacts) {
            const saved = this.storage.get('phone_call_contacts', null);
            if (saved) {
                try {
                    this._contacts = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析通话联系人失败:', e);
                    this._contacts = [];
                }
            } else {
                this._contacts = [];
            }
        }
        return Array.isArray(this._contacts) ? this._contacts : [];
    }

    saveContacts() {
        this.storage.set('phone_call_contacts', this.getContacts());
    }

    addContact(name) {
        const safeName = String(name || '').trim();
        if (!safeName) return null;
        const contacts = this.getContacts();
        const exists = contacts.find(item => String(item?.name || '').trim() === safeName);
        if (exists) return exists;

        const contact = {
            id: `phone_contact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: safeName,
            createdAt: Date.now()
        };
        contacts.push(contact);
        this.saveContacts();
        return contact;
    }

    deleteContact(id) {
        const safeId = String(id || '').trim();
        if (!safeId) return false;
        const contacts = this.getContacts();
        const idx = contacts.findIndex(item => String(item?.id || '').trim() === safeId);
        if (idx < 0) return false;
        contacts.splice(idx, 1);
        this.saveContacts();
        return true;
    }

    // 清空缓存（切换聊天时调用）
    clearCache() {
        this._callHistory = null;
        this._contacts = null;
    }
}
