/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  日历数据层
 * ======================================================== */

export class CalendarData {
    constructor(storage) {
        this.storage = storage;
        this.memoKey = 'calendar_memos';
        this.themeKey = 'calendar_theme';
        this.reminderEnabledKey = 'calendar_reminder_enabled';
        this._memos = null;
    }

    getMemos() {
        if (!this._memos) {
            try {
                const saved = this.storage?.get?.(this.memoKey, '[]');
                const parsed = Array.isArray(saved) ? saved : JSON.parse(saved || '[]');
                this._memos = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
            } catch (e) {
                console.warn('[CalendarData] 解析备忘录失败:', e);
                this._memos = [];
            }
        }
        return this._memos;
    }

    getMemosByDate(dateKey) {
        const key = String(dateKey || '').trim();
        return this.getMemos()
            .filter(memo => this.isMemoOnDate(memo, key))
            .sort((a, b) => {
                const pinnedDiff = (b.pinned === true) - (a.pinned === true);
                if (pinnedDiff) return pinnedDiff;
                return String(a.time || '').localeCompare(String(b.time || ''));
            });
    }

    getMemoDatesForMonth(year, month) {
        const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-`;
        const map = new Map();
        this.getMemos().forEach(memo => {
            const key = String(memo?.dateKey || '');
            if (key.startsWith(prefix)) {
                map.set(key, (map.get(key) || 0) + 1);
                return;
            }

            if (!this.isRecurringMemo(memo)) return;
            const parts = this.parseDateKey(key);
            if (!parts) return;
            const targetMonth = Number(month);
            const targetYear = Number(year);
            if (this.normalizeType(memo?.type) === 'birthday' && parts.month !== targetMonth) return;
            if (this.normalizeType(memo?.type) === 'anniversary') {
                const targetSerial = this.dateSerial({ year: targetYear, month: targetMonth, day: parts.day });
                if (targetSerial < this.dateSerial(parts)) return;
            }
            if (parts.day > this.getDaysInMonth(targetYear, targetMonth)) return;
            const recurringKey = `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
            map.set(recurringKey, (map.get(recurringKey) || 0) + 1);
        });
        return map;
    }

    addMemo({ dateKey, title, time = '', type = 'daily', color = 'blue', source = 'manual' }) {
        const safeDateKey = String(dateKey || '').trim();
        const safeTitle = String(title || '').trim();
        if (!safeDateKey || !safeTitle) return null;
        const safeType = this.normalizeType(type);

        const memo = {
            id: `calendar_memo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            dateKey: safeDateKey,
            title: safeTitle.slice(0, 160),
            time: String(time || '').trim().slice(0, 16),
            color: this.normalizeColor(color),
            type: safeType,
            source: String(source || 'manual').trim() || 'manual',
            createdAt: Date.now(),
            pinned: false
        };

        this.getMemos().push(memo);
        this.saveMemos();
        return memo;
    }

    updateMemo(id, updates = {}) {
        const memo = this.getMemos().find(item => String(item?.id || '') === String(id || ''));
        if (!memo) return false;

        if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
            const safeTitle = String(updates.title || '').trim();
            if (!safeTitle) return false;
            memo.title = safeTitle.slice(0, 160);
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'time')) {
            memo.time = String(updates.time || '').trim().slice(0, 16);
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'type')) {
            memo.type = this.normalizeType(updates.type);
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'remindedKeys')) {
            memo.remindedKeys = Array.isArray(updates.remindedKeys) ? updates.remindedKeys : [];
        }
        memo.updatedAt = Date.now();
        this.saveMemos();
        return true;
    }

    deleteMemo(id) {
        const safeId = String(id || '').trim();
        if (!safeId) return false;
        const memos = this.getMemos();
        const idx = memos.findIndex(memo => String(memo?.id || '') === safeId);
        if (idx < 0) return false;
        memos.splice(idx, 1);
        this.saveMemos();
        return true;
    }

    togglePinned(id) {
        const memo = this.getMemos().find(item => String(item?.id || '') === String(id || ''));
        if (!memo) return false;
        memo.pinned = memo.pinned !== true;
        this.saveMemos();
        return true;
    }

    clearExpiredAutoMemos(currentDateKey) {
        const currentParts = this.parseDateKey(currentDateKey);
        if (!currentParts) return 0;
        const currentSerial = this.dateSerial(currentParts);
        const memos = this.getMemos();
        const before = memos.length;
        this._memos = memos.filter(memo => {
            if (String(memo?.source || '') !== 'auto_schedule') return true;
            if (this.isRecurringMemo(memo)) return true;
            const memoParts = this.parseDateKey(memo?.dateKey);
            if (!memoParts) return true;
            if (this.dateSerial(memoParts) >= currentSerial) return true;
            if (!this.isReminderEnabled()) return false;
            return !this.hasMemoReminderFired(memo, memo.dateKey);
        });
        const removed = before - this._memos.length;
        if (removed > 0) this.saveMemos();
        return removed;
    }

    saveMemos() {
        this.storage?.set?.(this.memoKey, JSON.stringify(this.getMemos()));
    }

    isReminderEnabled() {
        const raw = this.storage?.get?.(this.reminderEnabledKey, false);
        return raw === true || raw === 'true' || raw === 1 || raw === '1';
    }

    setReminderEnabled(enabled) {
        const value = !!enabled;
        this.storage?.set?.(this.reminderEnabledKey, value);
        return value;
    }

    getTheme() {
        const theme = String(this.storage?.get?.(this.themeKey, 'light') || 'light');
        return theme === 'dark' ? 'dark' : 'light';
    }

    setTheme(theme) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        this.storage?.set?.(this.themeKey, nextTheme);
        return nextTheme;
    }

    normalizeColor(color) {
        const value = String(color || '').trim();
        return ['blue', 'red', 'purple', 'green', 'amber'].includes(value) ? value : 'blue';
    }

    normalizeType(type) {
        const value = String(type || '').trim();
        return ['daily', 'work', 'date', 'birthday', 'anniversary', 'study', 'travel', 'health', 'money', 'event'].includes(value)
            ? value
            : 'daily';
    }

    getDaysInMonth(year, month) {
        if ([1, 3, 5, 7, 8, 10, 12].includes(Number(month))) return 31;
        if ([4, 6, 9, 11].includes(Number(month))) return 30;
        const y = Number(year);
        return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28;
    }

    isRecurringMemo(memo) {
        const type = this.normalizeType(memo?.type);
        return type === 'birthday' || type === 'anniversary';
    }

    isMemoOnDate(memo, dateKey) {
        const memoKey = String(memo?.dateKey || '').trim();
        const targetKey = String(dateKey || '').trim();
        if (!memoKey || !targetKey) return false;
        if (memoKey === targetKey) return true;
        if (!this.isRecurringMemo(memo)) return false;

        const memoParts = this.parseDateKey(memoKey);
        const targetParts = this.parseDateKey(targetKey);
        if (!memoParts || !targetParts || memoParts.day !== targetParts.day) return false;

        const type = this.normalizeType(memo?.type);
        if (type === 'birthday') {
            return memoParts.month === targetParts.month;
        }
        if (type === 'anniversary') {
            return this.dateSerial(targetParts) >= this.dateSerial(memoParts);
        }
        return false;
    }

    getReminderDueMemo(previousTime, currentTime) {
        if (!this.isReminderEnabled()) return null;
        const prev = this.normalizeStoryTime(previousTime);
        const curr = this.normalizeStoryTime(currentTime);
        if (!curr) return null;
        if (prev && prev.dateKey !== curr.dateKey) {
            const prevParts = this.parseDateKey(prev.dateKey);
            const currParts = this.parseDateKey(curr.dateKey);
            if (!prevParts || !currParts || this.dateSerial(currParts) < this.dateSerial(prevParts)) {
                return { skipped: true, reason: 'time_rewind' };
            }
        }

        const currentMinutes = curr.minutes;
        const previousMinutes = prev?.dateKey === curr.dateKey ? prev.minutes : -1;
        if (currentMinutes <= previousMinutes) return null;

        const due = this.getMemosByDate(curr.dateKey)
            .filter(memo => this.isMemoReminderCandidate(memo, curr.dateKey))
            .map(memo => {
                const memoMinutes = this.parseTimeToMinutes(memo.time);
                return Number.isFinite(memoMinutes) ? { memo, memoMinutes } : null;
            })
            .filter(Boolean)
            .filter(item => item.memoMinutes > previousMinutes && item.memoMinutes <= currentMinutes)
            .filter(item => !this.hasMemoReminderFired(item.memo, curr.dateKey))
            .sort((a, b) => b.memoMinutes - a.memoMinutes);

        const hit = due[0];
        if (!hit) return null;
        return {
            memo: hit.memo,
            dateKey: curr.dateKey,
            time: this.formatMinutes(hit.memoMinutes),
            title: String(hit.memo?.title || '').trim()
        };
    }

    markMemoReminderFired(memoId, dateKey) {
        const memo = this.getMemos().find(item => String(item?.id || '') === String(memoId || ''));
        if (!memo) return false;
        const key = this.getMemoReminderKey(memo, dateKey);
        const list = Array.isArray(memo.remindedKeys) ? memo.remindedKeys : [];
        if (!list.includes(key)) list.push(key);
        memo.remindedKeys = list.slice(-240);
        memo.updatedAt = Date.now();
        this.saveMemos();
        return true;
    }

    isMemoReminderCandidate(memo, dateKey) {
        if (!memo || !this.parseTimeToMinutes(memo.time) && this.parseTimeToMinutes(memo.time) !== 0) return false;
        return this.isMemoOnDate(memo, dateKey);
    }

    hasMemoReminderFired(memo, dateKey) {
        const key = this.getMemoReminderKey(memo, dateKey);
        return Array.isArray(memo?.remindedKeys) && memo.remindedKeys.includes(key);
    }

    getMemoReminderKey(memo, dateKey) {
        return `${String(dateKey || '')}|${String(memo?.time || '').trim()}|${String(memo?.title || '').trim()}`;
    }

    parseDateKey(dateKey) {
        const match = String(dateKey || '').match(/^(\d{1,6})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        return {
            year: Number.parseInt(match[1], 10),
            month: Number.parseInt(match[2], 10),
            day: Number.parseInt(match[3], 10)
        };
    }

    dateSerial(dateParts) {
        return (Number(dateParts.year) * 372) + (Number(dateParts.month) * 31) + Number(dateParts.day);
    }

    normalizeStoryTime(timeData) {
        if (!timeData?.date || !timeData?.time) return null;
        const dateMatch = String(timeData.date).match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        if (!dateMatch) return null;
        const minutes = this.parseTimeToMinutes(timeData.time);
        if (!Number.isFinite(minutes)) return null;
        const dateKey = [
            String(dateMatch[1]).padStart(4, '0'),
            String(Number.parseInt(dateMatch[2], 10)).padStart(2, '0'),
            String(Number.parseInt(dateMatch[3], 10)).padStart(2, '0')
        ].join('-');
        return { dateKey, minutes };
    }

    parseTimeToMinutes(timeText) {
        const match = String(timeText || '').match(/^(\d{1,2})\s*[:：]\s*(\d{2})$/);
        if (!match) return NaN;
        const hour = Number.parseInt(match[1], 10);
        const minute = Number.parseInt(match[2], 10);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return NaN;
        return hour * 60 + minute;
    }

    formatMinutes(totalMinutes) {
        const minutes = Math.max(0, Number(totalMinutes) || 0);
        const hour = Math.floor(minutes / 60) % 24;
        const minute = minutes % 60;
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    clearCache() {
        this._memos = null;
    }
}
