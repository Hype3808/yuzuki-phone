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

export class ImageGenerationManager {
    constructor(storage) {
        this.storage = storage;
        this._queueUserId = null;
        this._lastQueueNotice = '';
        this._sdModelsCache = null;
        this._sdModelsCacheUrl = '';
        this._sdModelsCacheTime = 0;
        this._sdModelsCacheTtl = 5 * 60 * 1000;
        this._csrfToken = null;
        this._csrfTokenPromise = null;
    }

    _get(key, fallback = '') {
        const value = this.storage?.get?.(key);
        if (value === null || value === undefined || value === '') return fallback;
        return value;
    }

    _getBool(key, fallback = false) {
        const value = this.storage?.get?.(key);
        if (value === null || value === undefined || value === '') return fallback;
        return value === true || value === 'true';
    }

    _getNumber(key, fallback, min = null, max = null) {
        const raw = this.storage?.get?.(key);
        if (raw === null || raw === undefined || raw === '') return fallback;
        const value = Number(raw);
        let result = Number.isFinite(value) ? value : fallback;
        if (min !== null) result = Math.max(min, result);
        if (max !== null) result = Math.min(max, result);
        return result;
    }

    _normalizeSdBaseUrl(value) {
        let baseUrl = String(value || '').trim().replace(/\/+$/, '');
        if (!baseUrl) return '';
        if (!/^https?:\/\/.+/i.test(baseUrl)) {
            baseUrl = `http://${baseUrl.replace(/^\/+/, '')}`;
        }
        return baseUrl;
    }

    _normalizeApiBaseUrl(value, fallback = '') {
        let baseUrl = String(value || fallback || '').trim().replace(/\/+$/, '');
        if (!baseUrl) return '';
        if (!/^https?:\/\/.+/i.test(baseUrl)) {
            baseUrl = `https://${baseUrl.replace(/^\/+/, '')}`;
        }
        return baseUrl;
    }

    _normalizeSdAuth(value) {
        const auth = String(value || '').trim();
        if (!auth) return '';
        if (/^basic\s+/i.test(auth)) return auth;
        if (!auth.includes(':')) return auth;
        try {
            return `Basic ${btoa(unescape(encodeURIComponent(auth)))}`;
        } catch (e) {
            return `Basic ${btoa(auth)}`;
        }
    }

    _buildSdHeaders(extra = {}, config = null) {
        const headers = { ...extra };
        const auth = this._normalizeSdAuth(config?.sdAuth || this._get('phone-image-sd-auth', ''));
        if (auth) headers.Authorization = auth;
        return headers;
    }

    _isSillyTavern() {
        try {
            const inBrowser = typeof window !== 'undefined';
            return Boolean(
                (inBrowser && window.location && window.location.port === '8000') ||
                (typeof globalThis !== 'undefined' && globalThis.SillyTavern)
            );
        } catch (e) {
            return false;
        }
    }

    async _getCsrfToken() {
        if (this._csrfToken) return this._csrfToken;
        if (this._csrfTokenPromise) return this._csrfTokenPromise;
        this._csrfTokenPromise = (async () => {
            try {
                const response = await fetch('/csrf-token');
                if (!response.ok) return null;
                const data = await response.json().catch(() => null);
                this._csrfToken = String(data?.token || '').trim() || null;
                return this._csrfToken;
            } catch (e) {
                this._csrfTokenPromise = null;
                return null;
            }
        })();
        return this._csrfTokenPromise;
    }

    async _sdProxyRequest(endpoint, body = {}, method = 'POST') {
        const token = await this._getCsrfToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-CSRF-Token'] = token;
        return fetch(`/api/sd/${endpoint}`, {
            method,
            headers,
            body: method === 'GET' ? undefined : JSON.stringify(body || {})
        });
    }

    _normalizeSdListPayload(payload) {
        return Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.items)
                ? payload.items
                : (Array.isArray(payload?.data)
                    ? payload.data
                    : (Array.isArray(payload?.result) ? payload.result : [])));
    }

    _mapSdListItems(payload, mapper = item => item) {
        return this._normalizeSdListPayload(payload)
            .map(mapper)
            .map(item => String(item || '').trim())
            .filter(Boolean);
    }

    _sdDirectRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(options.method || 'GET', url, true);
            if (options.headers) {
                Object.entries(options.headers).forEach(([key, value]) => {
                    xhr.setRequestHeader(key, value);
                });
            }
            xhr.responseType = 'text';
            xhr.timeout = Number(options.timeout || 120000);
            xhr.onload = () => {
                resolve({
                    ok: xhr.status >= 200 && xhr.status < 300,
                    status: xhr.status,
                    statusText: xhr.statusText,
                    text: () => Promise.resolve(xhr.responseText || ''),
                    json: () => {
                        try {
                            return Promise.resolve(JSON.parse(xhr.responseText || 'null'));
                        } catch (err) {
                            return Promise.reject(err);
                        }
                    }
                });
            };
            xhr.onerror = () => reject(new Error(`请求失败: ${url}`));
            xhr.ontimeout = () => reject(new Error(`请求超时: ${url}`));
            xhr.send(options.body || null);
        });
    }

    _normalizeNovelAISampler(value) {
        const sampler = String(value || '').trim();
        const allowed = new Set([
            'k_euler',
            'ddim_v3',
            'k_dpmpp_2s_ancestral',
            'k_dpmpp_2m',
            'k_euler_ancestral',
            'k_dpmpp_2m_sde',
            'k_dpmpp_sde'
        ]);
        return allowed.has(sampler) ? sampler : 'k_euler';
    }

    _normalizeNovelAISchedule(value) {
        const schedule = String(value || '').trim();
        const allowed = new Set(['native', 'exponential', 'polyexponential', 'karras']);
        return allowed.has(schedule) ? schedule : 'native';
    }

    _isNovelAIV4Model(model) {
        return /^nai-diffusion-4(?:-|$)/i.test(String(model || '').trim());
    }

    _clampReferenceValue(value, fallback = 0.7, min = 0, max = 1) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num)) return fallback;
        const clamped = Math.max(min, Math.min(max, num));
        return Math.round(clamped * 100) / 100;
    }

    _normalizeNovelAIReferenceImage(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const dataUrlMatch = raw.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
        if (dataUrlMatch) return dataUrlMatch[1].replace(/\s+/g, '');
        if (/^[A-Za-z0-9+/=\s]+$/.test(raw.slice(0, 120))) return raw.replace(/\s+/g, '');
        return '';
    }

    _buildNovelAIReferenceCacheKey(imageBase64 = '') {
        const text = String(imageBase64 || '');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return `phone-ref-${(hash >>> 0).toString(16)}-${text.length}`;
    }

    _normalizeNovelAIReferences(options = {}) {
        const rawList = Array.isArray(options.novelAIReferences)
            ? options.novelAIReferences
            : (Array.isArray(options.referenceImages) ? options.referenceImages : []);
        return rawList
            .map((item) => {
                const image = typeof item === 'string'
                    ? this._normalizeNovelAIReferenceImage(item)
                    : this._normalizeNovelAIReferenceImage(item?.image || item?.imageData || item?.dataUrl || item?.base64);
                if (!image) return null;
                return {
                    image,
                    cacheSecretKey: String(item?.cacheSecretKey || item?.cache_secret_key || '').trim()
                        || this._buildNovelAIReferenceCacheKey(image),
                    strength: this._clampReferenceValue(item?.strength ?? item?.referenceStrength, 0.7, 0, 1),
                    informationExtracted: this._clampReferenceValue(
                        item?.informationExtracted ?? item?.referenceInformationExtracted,
                        1,
                        0,
                        1
                    )
                };
            })
            .filter(Boolean)
            .slice(0, 4);
    }

    _normalizeSdReferenceImages(options = {}) {
        const rawList = Array.isArray(options.novelAIReferences)
            ? options.novelAIReferences
            : (Array.isArray(options.referenceImages) ? options.referenceImages : []);
        return rawList
            .map((item) => {
                const image = typeof item === 'string'
                    ? this._normalizeNovelAIReferenceImage(item)
                    : this._normalizeNovelAIReferenceImage(item?.image || item?.imageData || item?.dataUrl || item?.base64);
                return image || '';
            })
            .filter(Boolean)
            .slice(0, 1);
    }

    _containsCjk(text) {
        return /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(String(text || ''));
    }

    _cleanNovelAITagText(text) {
        return String(text || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ''))
            .replace(/^\s*(?:prompt|positive prompt|tags?|nai tags?|english tags?|提示词|正面提示词)\s*[:：]/i, '')
            .replace(/[\r\n;；]+/g, ', ')
            .replace(/[，、]/g, ', ')
            .replace(/[。！？]/g, '')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s{2,}/g, ' ')
            .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
            .trim();
    }

    async _translatePromptForNovelAI(rawPrompt, appKey = '') {
        const source = String(rawPrompt || '').trim();
        if (!source || !this._containsCjk(source)) return source;

        const apiManager = (typeof window !== 'undefined') ? window.VirtualPhone?.apiManager : null;
        if (!apiManager || typeof apiManager.callAI !== 'function') {
            return source;
        }

        const appName = ['wechat', 'weibo'].includes(appKey) ? appKey : 'phone_online';
        const messages = [
            {
                role: 'system',
                content: [
                    'You convert Chinese image descriptions into NovelAI positive prompt tags.',
                    'Output only English comma-separated tags.',
                    'Do not add explanations, Markdown, Chinese, or full sentences.',
                    'Preserve visible subject, gender, count, pose, expression, clothing, setting, camera distance, angle, atmosphere, and anime illustration style.',
                    'If the source implies people or humanoids, include clear tags such as 1girl, 1boy, adult character, male focus, or female focus when appropriate.',
                    'Do not add unrelated quality tags unless they are clearly requested by the source.'
                ].join('\n')
            },
            {
                role: 'user',
                content: `Chinese source description:\n${source}\n\nEnglish NovelAI tags only:`
            }
        ];

        try {
            const result = await apiManager.callAI(messages, {
                appId: appName,
                max_tokens: 360,
                stream: false
            });
            const translated = this._cleanNovelAITagText(result?.summary || result?.content || result?.text || '');
            if (translated && !this._containsCjk(translated)) {
                return translated;
            }
        } catch (e) {
            console.warn('[NovelAI] 中文提示词自动转英文失败，已回退原描述:', e);
        }
        return source;
    }

    async _prepareNovelAIOptions(options = {}) {
        const appKey = String(options?.app || '').trim().toLowerCase();
        if (!['wechat', 'weibo'].includes(appKey)) return options;

        const rawPrompt = String(options.prompt || '').trim();
        if (!this._containsCjk(rawPrompt)) return options;

        const translatedPrompt = await this._translatePromptForNovelAI(rawPrompt, appKey);
        if (!translatedPrompt || translatedPrompt === rawPrompt) return options;

        return {
            ...options,
            rawPrompt,
            prompt: translatedPrompt,
            translatedPrompt
        };
    }

    _getAppDefaultSize(app) {
        switch (String(app || '').trim().toLowerCase()) {
            case 'honey':
                return { width: 832, height: 1216 };
            case 'wechat':
                return { width: 512, height: 512 };
            case 'weibo':
                return { width: 1024, height: 1024 };
            default:
                return { width: 832, height: 1216 };
        }
    }

    getSizeForApp(app = '') {
        const appKey = String(app || '').trim().toLowerCase();
        const defaults = this._getAppDefaultSize(appKey);
        if (!appKey) {
            return {
                width: this._getNumber('phone-image-width', defaults.width, 64, 2048),
                height: this._getNumber('phone-image-height', defaults.height, 64, 2048)
            };
        }

        return {
            width: this._getNumber(`phone-image-${appKey}-width`, defaults.width, 64, 2048),
            height: this._getNumber(`phone-image-${appKey}-height`, defaults.height, 64, 2048)
        };
    }

    getConfig(overrides = {}) {
        const provider = String(overrides.provider || this._get('phone-image-provider', 'novelai')).trim() || 'novelai';
        const appKey = String(overrides.app || '').trim().toLowerCase();
        const legacySiliconflowKey = String(this._get('siliconflow_api_key', '') || '').trim();
        const legacySiliconflowModel = String(this._get('image_generation_model', '') || '').trim();
        const appDefaults = this._getAppDefaultSize(appKey);
        const rawSize = this.getSizeForApp(appKey);
        const size = { ...rawSize };
        const rawSteps = this._getNumber('phone-image-steps', 28, 1, 50);
        const promptAppKey = ['honey', 'wechat', 'weibo'].includes(appKey) ? appKey : '';

        if (appKey === 'honey') {
            if (size.width < 512 || size.height < 768) {
                size.width = appDefaults.width;
                size.height = appDefaults.height;
            }
        }
        const steps = appKey === 'honey' && provider === 'novelai' && rawSteps < 20
            ? 28
            : rawSteps;

        const site = String(overrides.site || this._get('phone-image-novelai-site', 'official')).trim() || 'official';
        const openaiSite = String(overrides.openaiSite || this._get('phone-image-openai-site', 'official')).trim() || 'official';
        let apiKey = String(overrides.apiKey || this._get(`phone-image-${provider}-key`, '') || (provider === 'siliconflow' ? legacySiliconflowKey : '')).trim();
        if (provider === 'novelai' && site === 'public') {
            apiKey = String(overrides.apiKey || this._get('phone-image-novelai-public-key', '') || '').trim();
        } else if (provider === 'openai' && openaiSite === 'public') {
            apiKey = String(overrides.apiKey || this._get('phone-image-openai-public-key', '') || '').trim();
        }

        return {
            enabled: overrides.enabled ?? this._getBool('phone-image-enabled', false),
            provider,
            apiKey,
            site,
            openaiSite,
            openaiCustomUrl: String(overrides.openaiCustomUrl || this._get('phone-image-openai-url', '')).trim(),
            openaiPublicUrl: String(overrides.openaiPublicUrl || this._get('phone-image-openai-public-url', '')).trim(),
            openaiQuality: String(overrides.openaiQuality || this._get('phone-image-openai-quality', 'auto')).trim() || 'auto',
            sdUrl: this._normalizeSdBaseUrl(overrides.sdUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860')),
            sdAuth: String(overrides.sdAuth || this._get('phone-image-sd-auth', '')).trim(),
            sdVae: String(overrides.sdVae || this._get('phone-image-sd-vae', '')).trim(),
            sdScheduler: String(overrides.sdScheduler || this._get('phone-image-sd-scheduler', '')).trim(),
            sdClipSkip: this._getNumber('phone-image-sd-clip-skip', 0, 0, 12),
            sdLora: String(overrides.sdLora || this._get('phone-image-sd-lora', '')).trim(),
            sdHiresFix: this._getBool('phone-image-sd-hires-fix', false),
            sdHiresSteps: this._getNumber('phone-image-sd-hires-steps', 0, 0, 80),
            sdUpscaler: String(overrides.sdUpscaler || this._get('phone-image-sd-upscaler', '')).trim(),
            sdUpscaleFactor: this._getNumber('phone-image-sd-upscale-factor', 1.5, 1, 4),
            sdDenoisingStrength: this._getNumber('phone-image-sd-denoising-strength', 0.45, 0, 1),
            sdRestoreFaces: this._getBool('phone-image-sd-restore-faces', false),
            sdADetailer: this._getBool('phone-image-sd-adetailer', false),
            customUrl: String(overrides.customUrl || this._get('phone-image-novelai-url', '')).trim(),
            publicKey: String(overrides.publicKey || this._get('phone-image-novelai-public-key', '')).trim(),
            publicUrl: String(overrides.publicUrl || this._get('phone-image-novelai-public-url', '')).trim(),
            queueUrl: site === 'public' ? '' : String(overrides.queueUrl || this._get('phone-image-novelai-queue-url', '')).trim(),
            model: String(overrides.model || this._get(`phone-image-${provider}-model`, '') || (provider === 'novelai' ? 'nai-diffusion-4-5-full' : (provider === 'siliconflow' ? legacySiliconflowModel || 'Kwai-Kolors/Kolors' : (provider === 'openai' ? 'gpt-image-2' : '')))).trim(),
            sampler: provider === 'sd'
                ? String(overrides.sampler || this._get('phone-image-sd-sampler', 'Euler a')).trim() || 'Euler a'
                : this._normalizeNovelAISampler(overrides.sampler || this._get('phone-image-novelai-sampler', 'k_euler')),
            schedule: this._normalizeNovelAISchedule(overrides.schedule || this._get('phone-image-novelai-schedule', 'native')),
            width: size.width,
            height: size.height,
            steps,
            scale: this._getNumber('phone-image-scale', appKey === 'honey' ? 7 : 5, 0, 50),
            cfgRescale: this._getNumber('phone-image-cfg-rescale', 0, 0, 1),
            seed: this._getNumber('phone-image-seed', -1, -1, 4294967295),
            fixedPrompt: String(overrides.fixedPrompt ?? (promptAppKey ? this._get(`phone-image-${promptAppKey}-fixed-prompt`, '') : '')).trim(),
            fixedPromptEnd: String(overrides.fixedPromptEnd ?? (promptAppKey ? this._get(`phone-image-${promptAppKey}-fixed-prompt-end`, '') : '')).trim(),
            negativePrompt: String(overrides.negativePrompt ?? (promptAppKey ? this._get(`phone-image-${promptAppKey}-negative-prompt`, '') : '')).trim(),
            debugPayload: this._getBool('phone-image-debug-payload', false),
            saveToBackgrounds: this._getBool('phone-image-save-backgrounds', false)
        };
    }

    async generate(options = {}) {
        const config = this.getConfig(options);
        if (!config.enabled && options.ignoreEnabled !== true) throw new Error('生图功能未启用');
        if (config.provider !== 'sd' && !config.apiKey) throw new Error('缺少生图 API Key');

        if (config.provider === 'siliconflow') {
            return this._generateSiliconflow(options, config);
        }
        if (config.provider === 'sd') {
            return this._generateStableDiffusion(options, config);
        }
        if (config.provider === 'openai') {
            return this._generateOpenAIImage(options, config);
        }
        if (config.provider === 'novelai') {
            const novelAIOptions = await this._prepareNovelAIOptions(options);
            return this._generateNovelAI(novelAIOptions, config);
        }
        throw new Error(`暂不支持的生图服务商：${config.provider}`);
    }

    _joinPrompt(parts = [], separator = ', ') {
        return parts
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .join(separator);
    }

    _debugNovelAIRequest({ endpoint, payload, config, options }) {
        if (!config?.debugPayload) return;
        const originalPrompt = String(options?.rawPrompt || options?.prompt || '').trim();
        const translatedPrompt = String(options?.translatedPrompt || '').trim();
        const debugPayload = this._redactNovelAIDebugPayload(payload);
        const debugInfo = {
            endpoint,
            provider: 'novelai',
            app: String(options?.app || '').trim(),
            model: config.model,
            sampler: config.sampler,
            schedule: config.schedule,
            width: payload?.parameters?.width,
            height: payload?.parameters?.height,
            steps: payload?.parameters?.steps,
            scale: payload?.parameters?.scale,
            cfgRescale: payload?.parameters?.cfg_rescale,
            seed: payload?.parameters?.seed,
            originalPrompt,
            translatedPrompt,
            positivePrompt: payload?.input || '',
            negativePrompt: payload?.parameters?.negative_prompt || '',
            referenceCount: Array.isArray(payload?.parameters?.reference_image_multiple_cached)
                ? payload.parameters.reference_image_multiple_cached.length
                : (Array.isArray(payload?.parameters?.director_reference_images_cached)
                    ? payload.parameters.director_reference_images_cached.length
                    : (Array.isArray(payload?.parameters?.director_reference_images)
                        ? payload.parameters.director_reference_images.length
                        : (Array.isArray(payload?.parameters?.reference_image_multiple)
                            ? payload.parameters.reference_image_multiple.length
                            : 0))),
            payload: debugPayload
        };
        try {
            if (typeof window !== 'undefined') {
                window.__lastNovelAIRequest = debugInfo;
            }
        } catch (e) {}
        try {
            const plainText = [
                '[NovelAI Debug] 本次生图参数',
                `App: ${debugInfo.app || '-'}`,
                `模型: ${debugInfo.model}`,
                `尺寸: ${debugInfo.width}x${debugInfo.height}`,
                `Steps: ${debugInfo.steps}`,
                `Sampler: ${debugInfo.sampler}`,
                `Schedule: ${debugInfo.schedule}`,
                `Scale: ${debugInfo.scale}`,
                `CFG Rescale: ${debugInfo.cfgRescale}`,
                `Seed: ${debugInfo.seed}`,
                `参考图: ${debugInfo.referenceCount} 张`,
                '',
                'AI 画面 tag（原样）:',
                debugInfo.originalPrompt || '(空)',
                ...(debugInfo.translatedPrompt ? [
                    '',
                    '自动转英文后的 NAI tag:',
                    debugInfo.translatedPrompt
                ] : []),
                '',
                '最终发送给 NAI 的正面提示词:',
                debugInfo.positivePrompt || '(空)',
                '',
                '最终发送给 NAI 的负面提示词:',
                debugInfo.negativePrompt || '(空)',
                '',
                '调试 payload 已保存到 window.__lastNovelAIRequest（参考图 base64 已脱敏）',
                '复制完整调试信息: copy(JSON.stringify(window.__lastNovelAIRequest, null, 2))'
            ].join('\n');
            console.log(plainText);
            console.groupCollapsed('[NovelAI Debug] generate-image payload');
            console.info('summary', {
                endpoint: debugInfo.endpoint,
                app: debugInfo.app,
                model: debugInfo.model,
                size: `${debugInfo.width}x${debugInfo.height}`,
                steps: debugInfo.steps,
                sampler: debugInfo.sampler,
                schedule: debugInfo.schedule,
                scale: debugInfo.scale,
                cfgRescale: debugInfo.cfgRescale,
                seed: debugInfo.seed,
                referenceCount: debugInfo.referenceCount
            });
            console.info('AI 画面 tag（原样）', debugInfo.originalPrompt);
            if (debugInfo.translatedPrompt) console.info('自动转英文后的 NAI tag', debugInfo.translatedPrompt);
            console.info('positive prompt', debugInfo.positivePrompt);
            console.info('negative prompt', debugInfo.negativePrompt);
            console.info('full payload', debugInfo.payload);
            console.info('copy helper', 'copy(JSON.stringify(window.__lastNovelAIRequest, null, 2))');
            console.groupEnd();
        } catch (e) {}
    }

    _redactNovelAIDebugPayload(payload) {
        try {
            const clone = JSON.parse(JSON.stringify(payload || {}));
            const refs = clone?.parameters?.reference_image_multiple;
            if (Array.isArray(refs)) {
                clone.parameters.reference_image_multiple = refs.map((item, index) => {
                    const length = String(item || '').length;
                    return `[BASE64_REFERENCE_IMAGE_${index + 1}:${length}]`;
                });
            }
            const cachedRefs = clone?.parameters?.reference_image_multiple_cached;
            if (Array.isArray(cachedRefs)) {
                clone.parameters.reference_image_multiple_cached = cachedRefs.map((item, index) => ({
                    cache_secret_key: String(item?.cache_secret_key || ''),
                    data: `[BASE64_REFERENCE_IMAGE_CACHED_${index + 1}:${String(item?.data || '').length}]`
                }));
            }
            const directorRefs = clone?.parameters?.director_reference_images;
            if (Array.isArray(directorRefs)) {
                clone.parameters.director_reference_images = directorRefs.map((item, index) => {
                    const length = String(item || '').length;
                    return `[BASE64_DIRECTOR_REFERENCE_IMAGE_${index + 1}:${length}]`;
                });
            }
            const cachedDirectorRefs = clone?.parameters?.director_reference_images_cached;
            if (Array.isArray(cachedDirectorRefs)) {
                clone.parameters.director_reference_images_cached = cachedDirectorRefs.map((item, index) => ({
                    cache_secret_key: String(item?.cache_secret_key || ''),
                    data: `[BASE64_DIRECTOR_REFERENCE_IMAGE_CACHED_${index + 1}:${String(item?.data || '').length}]`
                }));
            }
            return clone;
        } catch (e) {
            return payload;
        }
    }

    _resolveNovelAIEndpoint(config) {
        if (config.site === 'public') {
            if (!config.publicUrl) throw new Error('缺少公益站 Base URL');
            return config.publicUrl.replace(/\/+$/, '');
        }
        if (config.site === 'custom' && config.customUrl) {
            return config.customUrl.replace(/\/+$/, '');
        }
        return 'https://image.novelai.net';
    }

    _resolveNovelAIQueueUrl(config) {
        return String(config?.queueUrl || '').trim().replace(/\/+$/, '');
    }

    _createQueueTaskId() {
        return `phone-nai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    _getQueueUserId() {
        if (this._queueUserId) return this._queueUserId;
        const storageKey = 'phone_nai_queue_user_id';
        try {
            const stored = window.localStorage?.getItem(storageKey);
            if (stored) {
                this._queueUserId = stored;
                return stored;
            }
            const cryptoApi = globalThis.crypto;
            const randomPart = typeof cryptoApi?.randomUUID === 'function'
                ? cryptoApi.randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
            const userId = `phone-${randomPart}`;
            window.localStorage?.setItem(storageKey, userId);
            this._queueUserId = userId;
            return userId;
        } catch (e) {
            this._queueUserId = `phone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
            return this._queueUserId;
        }
    }

    async _hashQueueKey(apiKey) {
        const text = String(apiKey || '');
        if (!text) throw new Error('缺少 NAI API Key，无法进入共享队列');
        try {
            const cryptoApi = globalThis.crypto;
            if (typeof cryptoApi?.subtle?.digest === 'function' && typeof TextEncoder === 'function') {
                const buffer = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(text));
                return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {}

        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        }
        return `fallback-${Math.abs(hash).toString(16)}`;
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _getQueueToken(payload) {
        return String(payload?.token || payload?.queue_token || payload?.queueToken || '').trim();
    }

    _getQueuePosition(payload) {
        const raw = payload?.position ?? payload?.queue_position ?? payload?.rank;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    _getQueueSize(payload) {
        const raw = payload?.queue_size ?? payload?.queueSize ?? payload?.size;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    _formatQueueStatus(payload) {
        const position = this._getQueuePosition(payload);
        const size = this._getQueueSize(payload);
        if (position === null) return '';
        const displayPosition = Math.max(1, position + 1);
        if (size !== null && size > 0) return `NAI 队列排队中：第 ${displayPosition}/${size} 位`;
        return `NAI 队列排队中：第 ${displayPosition} 位`;
    }

    _noticeQueueStatus(payload, force = false) {
        const text = this._formatQueueStatus(payload);
        if (!text || (!force && text === this._lastQueueNotice)) return;
        this._lastQueueNotice = text;
        console.log(`[NovelAI Queue] ${text}`);
        try {
            window.VirtualPhone?.phoneShell?.showNotification?.('NAI 共享队列', text, '🎨');
        } catch (e) {}
    }

    async _queueRequest(baseUrl, path, { method = 'GET', body = null, query = null } = {}) {
        const url = new URL(`${baseUrl}${path}`);
        if (query && typeof query === 'object') {
            Object.entries(query).forEach(([key, value]) => {
                if (value !== null && value !== undefined && value !== '') {
                    url.searchParams.set(key, String(value));
                }
            });
        }

        const response = await fetch(url.toString(), {
            method,
            headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
            body: method === 'POST' ? JSON.stringify(body || {}) : undefined
        });
        const text = await response.text().catch(() => '');
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (!response.ok) {
            const message = payload?.message || payload?.error || text || '';
            throw new Error(`NAI 队列服务请求失败 (${response.status})${message ? `: ${String(message).slice(0, 180)}` : ''}`);
        }
        return payload || {};
    }

    async _waitForNovelAIQueueTurn(config, options = {}) {
        const baseUrl = this._resolveNovelAIQueueUrl(config);
        if (!baseUrl) return null;

        const keyHash = await this._hashQueueKey(config.apiKey);
        const userId = this._getQueueUserId();
        const taskId = String(options.queueTaskId || this._createQueueTaskId()).trim();
        const queuePayload = { key_hash: keyHash, user_id: userId, task_id: taskId };
        let token = '';
        let joined = false;
        let leftQueue = false;

        const leave = async () => {
            if (!joined || leftQueue) return;
            leftQueue = true;
            await this._queueRequest(baseUrl, '/leave-queue', {
                method: 'POST',
                body: { ...queuePayload, token }
            }).catch((err) => console.warn('[NovelAI Queue] 离开队列失败:', err));
        };

        try {
            const joinedInfo = await this._queueRequest(baseUrl, '/queue', {
                method: 'POST',
                body: queuePayload
            });
            joined = true;
            token = this._getQueueToken(joinedInfo);
            this._noticeQueueStatus(joinedInfo, true);
            if (joinedInfo?.can_run && token) {
                return { baseUrl, keyHash, userId, taskId, token };
            }

            for (let retry = 0; retry < 120; retry++) {
                if (options?.signal?.aborted) {
                    await leave();
                    throw new Error('已取消 NAI 生图队列等待');
                }
                await this._sleep(3000);
                const turnInfo = await this._queueRequest(baseUrl, '/my-turn', {
                    query: queuePayload
                });
                token = this._getQueueToken(turnInfo) || token;
                this._noticeQueueStatus(turnInfo);
                if (turnInfo?.can_run && token) {
                    return { baseUrl, keyHash, userId, taskId, token };
                }
            }

            await leave();
            throw new Error('等待 NAI 共享队列超时，请稍后重试');
        } catch (err) {
            if (!String(err?.message || '').includes('已取消 NAI 生图队列等待')) {
                await leave();
            }
            throw err;
        }
    }

    async _finishNovelAIQueue(queueInfo) {
        if (!queueInfo?.baseUrl || !queueInfo?.token) return;
        await this._queueRequest(queueInfo.baseUrl, '/complete', {
            method: 'POST',
            body: {
                key_hash: queueInfo.keyHash,
                user_id: queueInfo.userId,
                task_id: queueInfo.taskId,
                token: queueInfo.token
            }
        }).catch((err) => console.warn('[NovelAI Queue] 完成队列任务失败:', err));
    }

    _extractBase64Image(payload) {
        const candidates = [
            payload?.image,
            payload?.imageData,
            payload?.data,
            payload?.output,
            payload?.images?.[0],
            payload?.result?.image,
            payload?.result?.images?.[0]
        ];
        for (const item of candidates) {
            if (!item) continue;
            if (typeof item === 'string') {
                if (item.startsWith('data:image/')) return item;
                if (/^[A-Za-z0-9+/=\s]+$/.test(item.slice(0, 120))) return `data:image/png;base64,${item.replace(/\s+/g, '')}`;
            }
            if (typeof item === 'object') {
                const nested = this._extractBase64Image(item);
                if (nested) return nested;
            }
        }
        return '';
    }

    async _readZipImage(response) {
        const blob = await response.blob();
        if (!blob || blob.size <= 0) throw new Error('NovelAI 返回空图片数据');
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
        if (!isZip) {
            const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
            return await this._blobToDataUrl(new Blob([blob], { type: mime }));
        }

        if (window.JSZip) {
            const zip = await window.JSZip.loadAsync(arrayBuffer);
            const imageFile = Object.values(zip.files)
                .filter(file => !file.dir && /\.(png|jpg|jpeg|webp)$/i.test(file.name))
                .sort((a, b) => {
                    const sizeA = Number(a?._data?.uncompressedSize || a?._data?.compressedSize || 0);
                    const sizeB = Number(b?._data?.uncompressedSize || b?._data?.compressedSize || 0);
                    return sizeB - sizeA;
                })[0];
            if (!imageFile) throw new Error('NovelAI ZIP 中未找到图片文件');
            const imageBlob = await imageFile.async('blob');
            return await this._blobToDataUrl(imageBlob);
        }

        const imageBlob = await this._readZipImageNative(bytes, arrayBuffer);
        return await this._blobToDataUrl(imageBlob);
    }

    _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
            reader.readAsDataURL(blob);
        });
    }

    _waitForImageDecode(src, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            if (!src) {
                reject(new Error('图片数据为空'));
                return;
            }
            const image = new Image();
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error('图片解码超时'));
            }, timeoutMs);
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
            };
            image.onload = finish;
            image.onerror = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(new Error('图片解码失败'));
            };
            image.src = src;
            if (typeof image.decode === 'function') {
                image.decode().then(finish).catch(() => {
                    if (image.complete && image.naturalWidth > 0) finish();
                });
            }
        });
    }

    async _readZipImageNative(bytes, arrayBuffer) {
        const entry = this._findZipImageEntry(bytes, arrayBuffer);
        if (!entry) throw new Error('NovelAI ZIP 中未找到图片文件');

        const compressed = bytes.slice(entry.dataStart, entry.dataStart + entry.compressedSize);
        let fileBytes = compressed;
        if (entry.method === 8) {
            fileBytes = await this._inflateRawDeflate(compressed);
        } else if (entry.method !== 0) {
            throw new Error(`当前环境不支持 ZIP 压缩方式：${entry.method}`);
        }

        const lowerName = String(entry.name || '').toLowerCase();
        const mime = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
            ? 'image/jpeg'
            : (lowerName.endsWith('.webp') ? 'image/webp' : 'image/png');
        return new Blob([fileBytes], { type: mime });
    }

    _findZipImageEntry(bytes, arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const decoder = new TextDecoder('utf-8');
        const imageExtPattern = /\.(png|jpg|jpeg|webp)$/i;
        let bestEntry = null;

        for (let offset = 0; offset <= bytes.length - 46; offset++) {
            if (view.getUint32(offset, true) !== 0x02014b50) continue;
            const method = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const fileNameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localHeaderOffset = view.getUint32(offset + 42, true);
            const nameStart = offset + 46;
            const nameEnd = nameStart + fileNameLength;
            if (nameEnd > bytes.length) break;

            const name = decoder.decode(bytes.slice(nameStart, nameEnd));
            const nextOffset = nameEnd + extraLength + commentLength;
            if (!imageExtPattern.test(name) || compressedSize <= 0) {
                offset = Math.max(offset, nextOffset - 1);
                continue;
            }

            if (localHeaderOffset < 0 || localHeaderOffset + 30 > bytes.length) continue;
            if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
            const localNameLength = view.getUint16(localHeaderOffset + 26, true);
            const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
            const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
            if (dataStart + compressedSize > bytes.length) continue;

            const entry = { name, method, compressedSize, dataStart };
            if (!bestEntry || compressedSize > bestEntry.compressedSize) {
                bestEntry = entry;
            }
        }

        return bestEntry || null;
    }

    async _inflateRawDeflate(bytes) {
        if (typeof DecompressionStream !== 'function') {
            throw new Error('NovelAI 返回 ZIP，但当前浏览器缺少原生解压能力');
        }

        const tryInflate = async (format) => {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
            const buffer = await new Response(stream).arrayBuffer();
            return new Uint8Array(buffer);
        };

        try {
            return await tryInflate('deflate-raw');
        } catch (err) {
            try {
                return await tryInflate('deflate');
            } catch (fallbackErr) {
                throw err;
            }
        }
    }

    _buildNovelAIPayload(options, config) {
        const appKey = String(options.app || '').trim().toLowerCase();
        const rawPrompt = this._joinPrompt([
            config.fixedPrompt,
            options.prompt,
            config.fixedPromptEnd
        ]);
        const rawNegativePrompt = this._joinPrompt([
            config.negativePrompt,
            options.negativePrompt
        ]);
        const prompt = rawPrompt;
        const negativePrompt = rawNegativePrompt;
        const seed = Number(options.seed ?? config.seed);
        const appDefaults = this._getAppDefaultSize(appKey);
        let width = Number(options.width || config.width);
        let height = Number(options.height || config.height);
        let scale = Number(options.scale ?? config.scale);
        let steps = Number(options.steps || config.steps);
        const cfgRescale = Number(options.cfgRescale ?? config.cfgRescale);
        const novelAIReferences = this._normalizeNovelAIReferences(options);
        if (appKey === 'honey') {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width < 512 || height < 768) {
                width = appDefaults.width;
                height = appDefaults.height;
            }
            if (!Number.isFinite(steps) || steps < 20) {
                steps = 28;
            }
            if (!Number.isFinite(scale) || scale < 1) {
                scale = 7;
            }
        }
        if (appKey === 'weibo' && this._isNovelAIV4Model(config.model)) {
            const isSquare = width === height;
            if (!Number.isFinite(width) || !Number.isFinite(height) || (isSquare && width < 1024)) {
                width = 1024;
                height = 1024;
            }
        }
        const resolvedSeed = Number.isFinite(seed) && seed >= 0
            ? Math.floor(seed)
            : Math.floor(Math.random() * 4294967295);

        const parameters = {
            width,
            height,
            scale,
            sampler: config.sampler,
            steps,
            n_samples: 1,
            ucPreset: 0,
            qualityToggle: false,
            sm: false,
            sm_dyn: false,
            cfg_rescale: cfgRescale,
            noise_schedule: config.schedule,
            seed: resolvedSeed,
            negative_prompt: negativePrompt
        };

        if (this._isNovelAIV4Model(config.model)) {
            Object.assign(parameters, {
                params_version: 3,
                dynamic_thresholding: false,
                controlnet_strength: 1,
                legacy: false,
                add_original_image: false,
                legacy_v3_extend: false,
                v4_prompt: {
                    caption: {
                        base_caption: prompt,
                        char_captions: []
                    },
                    use_coords: false,
                    use_order: true
                },
                v4_negative_prompt: {
                    caption: {
                        base_caption: negativePrompt,
                        char_captions: []
                    },
                    legacy_uc: false
                }
            });

            if (novelAIReferences.length > 0) {
                Object.assign(parameters, {
                    director_reference_images: novelAIReferences.map(item => item.image),
                    director_reference_descriptions: novelAIReferences.map(() => ({
                        caption: {
                            base_caption: 'character&style',
                            char_captions: []
                        },
                        legacy_uc: false
                    })),
                    director_reference_information_extracted: novelAIReferences.map(item => item.informationExtracted),
                    director_reference_strength_values: novelAIReferences.map(item => item.strength),
                    director_reference_secondary_strength_values: novelAIReferences.map(() => 0)
                });
            }
        }

        return {
            input: prompt,
            model: config.model,
            action: 'generate',
            parameters
        };
    }

    previewFinalPrompt(options = {}) {
        const config = this.getConfig(options);
        const prompt = String(options.prompt || '').trim();
        return {
            provider: config.provider,
            app: String(options.app || '').trim().toLowerCase(),
            model: config.model,
            fixedPrompt: config.fixedPrompt,
            aiPrompt: prompt,
            fixedPromptEnd: config.fixedPromptEnd,
            positivePrompt: config.provider === 'siliconflow'
                ? this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd], '，')
                : this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd]),
            negativePrompt: this._joinPrompt([config.negativePrompt, options.negativePrompt]),
            seed: Number(options.seed ?? config.seed)
        };
    }

    async fetchSdModels(baseUrl) {
        const normalizedUrl = this._normalizeSdBaseUrl(baseUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860'));
        if (!normalizedUrl) throw new Error('未配置 Stable Diffusion 服务地址');

        const now = Date.now();
        if (
            this._sdModelsCache &&
            this._sdModelsCacheUrl === normalizedUrl &&
            now - this._sdModelsCacheTime < this._sdModelsCacheTtl
        ) {
            return this._sdModelsCache;
        }

        if (this._isSillyTavern()) {
            try {
                const response = await this._sdProxyRequest('models', { url: normalizedUrl });
                if (response.ok) {
                    const data = await response.json().catch(() => null);
                    let models = Array.isArray(data) ? data : [];
                    if (models.length > 0 && models[0]?.value !== undefined && models[0]?.text !== undefined) {
                        models = models.map(item => ({
                            title: String(item.value || item.text || ''),
                            model_name: String(item.text || item.value || '').replace(/\.[^.]+$/, ''),
                            hash: String(item.value || ''),
                            config: null
                        }));
                    }
                    if (models.length > 0) {
                        this._sdModelsCache = models;
                        this._sdModelsCacheUrl = normalizedUrl;
                        this._sdModelsCacheTime = now;
                        return models;
                    }
                }
            } catch (err) {
                console.warn('[SD] 代理获取模型列表失败，尝试直连:', err);
            }
        }

        const endpoints = ['/sdapi/v1/sd-models', '/api/sd-models'];
        let lastError = '';
        for (const endpoint of endpoints) {
            try {
                const response = await this._sdDirectRequest(`${normalizedUrl}${endpoint}`, {
                    method: 'GET',
                    headers: this._buildSdHeaders({ Accept: 'application/json' })
                });
                if (!response.ok) {
                    lastError = `HTTP ${response.status}: ${endpoint}`;
                    continue;
                }
                const models = await response.json();
                if (Array.isArray(models)) {
                    this._sdModelsCache = models;
                    this._sdModelsCacheUrl = normalizedUrl;
                    this._sdModelsCacheTime = now;
                    return models;
                }
                lastError = `${endpoint} 返回格式不是数组`;
            } catch (err) {
                lastError = `${endpoint}: ${err?.message || err}`;
            }
        }

        throw new Error(`SD 模型列表获取失败${lastError ? `: ${lastError}` : ''}。请确认 SD WebUI 已启动并开启 --api。`);
    }

    async _fetchSdProxyList(baseUrl, proxyEndpoint, mapper = item => item) {
        if (!this._isSillyTavern() || !proxyEndpoint) return [];
        const normalizedUrl = this._normalizeSdBaseUrl(baseUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860'));
        if (!normalizedUrl) return [];
        try {
            const response = await this._sdProxyRequest(proxyEndpoint, {
                url: normalizedUrl,
                auth: this._get('phone-image-sd-auth', '')
            });
            if (!response.ok) return [];
            const payload = await response.json().catch(() => null);
            return this._mapSdListItems(payload, mapper);
        } catch (err) {
            console.warn(`[SD] 代理获取列表失败 ${proxyEndpoint}:`, err);
            return [];
        }
    }

    async _fetchSdList(baseUrl, endpoints, mapper = item => item, proxyEndpoint = '') {
        const normalizedUrl = this._normalizeSdBaseUrl(baseUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860'));
        if (!normalizedUrl) return [];
        const endpointList = Array.isArray(endpoints) ? endpoints : [endpoints];
        for (const endpoint of endpointList) {
            try {
                const response = await this._sdDirectRequest(`${normalizedUrl}${endpoint}`, {
                    method: 'GET',
                    headers: this._buildSdHeaders({ Accept: 'application/json' })
                });
                if (!response.ok) continue;
                const payload = await response.json();
                const directItems = this._mapSdListItems(payload, mapper);
                if (directItems.length) return directItems;
            } catch (err) {
                console.warn(`[SD] 获取列表失败 ${endpoint}:`, err);
            }
        }
        const proxyItems = await this._fetchSdProxyList(normalizedUrl, proxyEndpoint, mapper);
        if (proxyItems.length) return proxyItems;
        return [];
    }

    async _refreshSdLoraIndex(baseUrl) {
        const normalizedUrl = this._normalizeSdBaseUrl(baseUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860'));
        if (!normalizedUrl) return;
        const endpoints = ['/sdapi/v1/refresh-loras', '/api/refresh-loras'];
        for (const endpoint of endpoints) {
            try {
                const response = await this._sdDirectRequest(`${normalizedUrl}${endpoint}`, {
                    method: 'POST',
                    headers: this._buildSdHeaders({ Accept: 'application/json' })
                });
                if (response.ok) return;
            } catch (err) {
                console.warn(`[SD] 刷新 LoRA 索引失败 ${endpoint}:`, err);
            }
        }
    }

    async fetchSdSamplers(baseUrl) {
        return this._fetchSdList(baseUrl, ['/sdapi/v1/samplers', '/api/samplers'], item => item?.name || item?.label || item?.value || item?.text, 'samplers');
    }

    async fetchSdSchedulers(baseUrl) {
        return this._fetchSdList(baseUrl, ['/sdapi/v1/schedulers', '/api/schedulers'], item => item?.name || item?.label || item?.value || item?.text, 'schedulers');
    }

    async fetchSdVae(baseUrl) {
        return this._fetchSdList(baseUrl, ['/sdapi/v1/sd-vae', '/api/sd-vae'], item => item?.model_name || item?.name || item?.filename || item?.value || item?.text, 'vaes');
    }

    async fetchSdUpscalers(baseUrl) {
        return this._fetchSdList(baseUrl, ['/sdapi/v1/upscalers', '/api/upscalers'], item => item?.name || item?.label || item?.value || item?.text, 'upscalers');
    }

    async fetchSdLoras(baseUrl) {
        await this._refreshSdLoraIndex(baseUrl).catch(() => {});
        return this._fetchSdList(baseUrl, ['/sdapi/v1/loras', '/api/loras'], item => {
            const name = item?.name || item?.alias || item?.metadata?.ss_output_name || item?.value || item?.text;
            return name || String(item?.path || item?.filename || '').replace(/\\/g, '/').split('/').pop()?.replace(/\.(safetensors|ckpt|pt)$/i, '');
        }, 'loras');
    }

    async fetchSdResources(baseUrl) {
        const [models, samplers, schedulers, vae, upscalers, loras] = await Promise.all([
            this.fetchSdModels(baseUrl).catch(() => []),
            this.fetchSdSamplers(baseUrl).catch(() => []),
            this.fetchSdSchedulers(baseUrl).catch(() => []),
            this.fetchSdVae(baseUrl).catch(() => []),
            this.fetchSdUpscalers(baseUrl).catch(() => []),
            this.fetchSdLoras(baseUrl).catch(() => [])
        ]);
        return { models, samplers, schedulers, vae, upscalers, loras };
    }

    buildSdModelHashMap(models) {
        const map = new Map();
        (Array.isArray(models) ? models : []).forEach((model) => {
            const names = [
                model?.model_name,
                model?.name,
                model?.title,
                model?.value,
                model?.text
            ].map(item => String(item || '').trim()).filter(Boolean);
            const hash = String(model?.hash || model?.sha256 || '').trim();
            if (!hash) return;
            names.forEach((name) => {
                map.set(name, hash);
                map.set(name.toLowerCase(), hash);
                map.set(name.replace(/\.[^.]+$/, ''), hash);
                map.set(name.replace(/\.[^.]+$/, '').toLowerCase(), hash);
            });
        });
        return map;
    }

    async getSdModelHash(baseUrl, modelName) {
        const name = String(modelName || '').trim();
        if (!name) return null;
        const models = await this.fetchSdModels(baseUrl);
        const map = this.buildSdModelHashMap(models);
        return map.get(name) || map.get(name.toLowerCase()) || null;
    }

    _extractSdImage(payload) {
        const candidates = [
            ...(Array.isArray(payload?.images) ? payload.images : []),
            payload?.image,
            payload?.data,
            payload?.output,
            payload?.result?.image,
            ...(Array.isArray(payload?.result?.images) ? payload.result.images : [])
        ];
        for (const item of candidates) {
            if (!item) continue;
            if (typeof item === 'string') {
                const text = item.trim();
                if (text.startsWith('data:image/')) return text;
                if (/^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 120))) {
                    return `data:image/png;base64,${text.replace(/\s+/g, '')}`;
                }
            } else if (typeof item === 'object') {
                const nested = this._extractSdImage(item);
                if (nested) return nested;
            }
        }
        return '';
    }

    _extractOpenAIImage(payload) {
        const candidates = [
            payload?.data?.[0]?.b64_json,
            payload?.data?.[0]?.url,
            payload?.images?.[0]?.url,
            payload?.images?.[0]?.b64_json,
            payload?.image_url,
            payload?.imageUrl,
            payload?.url,
            payload?.image,
            payload?.result?.image,
            payload?.result?.url,
            payload?.result?.images?.[0]?.url,
            payload?.result?.images?.[0]?.b64_json
        ];
        for (const item of candidates) {
            if (!item) continue;
            if (typeof item === 'string') {
                const text = item.trim();
                if (text.startsWith('data:image/')) return text;
                if (/^https?:\/\//i.test(text)) return text;
                if (/^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 120))) {
                    return `data:image/png;base64,${text.replace(/\s+/g, '')}`;
                }
            } else if (typeof item === 'object') {
                const nested = this._extractOpenAIImage(item);
                if (nested) return nested;
            }
        }
        return '';
    }

    _resolveOpenAIEndpoint(config) {
        const site = String(config.openaiSite || 'official').trim() || 'official';
        const baseUrl = site === 'public'
            ? this._normalizeApiBaseUrl(config.openaiPublicUrl)
            : (site === 'custom'
                ? this._normalizeApiBaseUrl(config.openaiCustomUrl)
                : 'https://api.openai.com');
        if (!baseUrl) throw new Error(site === 'public' ? '请先填写 GPT 公益站点 Base URL' : '请先填写 GPT 自定义 Base URL');
        if (/\/(?:v1\/)?images\/generations$/i.test(baseUrl)) return baseUrl;
        if (/\/images$/i.test(baseUrl)) return `${baseUrl}/generations`;
        if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/images/generations`;
        return `${baseUrl}/v1/images/generations`;
    }

    _resolveOpenAIModelsEndpoint(config) {
        const generationEndpoint = this._resolveOpenAIEndpoint(config);
        return generationEndpoint.replace(/\/(?:images\/generations|images\/edits|images\/variations)$/i, '/models');
    }

    _normalizeOpenAIModelItems(payload) {
        const source = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.data)
                ? payload.data
                : (Array.isArray(payload?.models)
                    ? payload.models
                    : (Array.isArray(payload?.result) ? payload.result : [])));
        const seen = new Set();
        return source
            .map((item) => {
                const id = typeof item === 'string'
                    ? item
                    : String(item?.id || item?.model || item?.name || '').trim();
                if (!id || seen.has(id)) return null;
                seen.add(id);
                const name = typeof item === 'string'
                    ? item
                    : String(item?.display_name || item?.displayName || item?.name || item?.id || id).trim();
                return { id, name: name || id };
            })
            .filter(Boolean);
    }

    _rankOpenAIImageModel(model) {
        const id = String(model?.id || '').toLowerCase();
        if (!id) return 999;
        if (id === 'gpt-image-2') return 0;
        if (/^gpt-image-2(?:-|$)/.test(id)) return 1;
        if (id === 'gpt-image-1.5') return 2;
        if (/^gpt-image-1\.5(?:-|$)/.test(id)) return 3;
        if (id === 'gpt-image-1') return 4;
        if (id === 'gpt-image-1-mini') return 5;
        if (/image|dall-e|flux|kolors|stable|sdxl|midjourney|mj/i.test(id)) return 20;
        return 100;
    }

    async fetchOpenAIModels(overrides = {}) {
        const config = {
            ...this.getConfig({ ...overrides, provider: 'openai' }),
            ...overrides,
            provider: 'openai'
        };
        if (!String(config.apiKey || '').trim()) throw new Error('请先填写 GPT 生图 API Key');
        const endpoint = this._resolveOpenAIModelsEndpoint(config);
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                Accept: 'application/json'
            },
            signal: overrides.signal
        });
        const text = await response.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (!response.ok) {
            const msg = payload?.error?.message || payload?.message || payload?.error || text || '';
            throw new Error(`GPT 模型列表拉取失败 (${response.status})${msg ? `: ${String(msg).slice(0, 180)}` : ''}`);
        }
        const allModels = this._normalizeOpenAIModelItems(payload);
        const imageModels = allModels
            .filter((item) => this._rankOpenAIImageModel(item) < 100)
            .sort((a, b) => this._rankOpenAIImageModel(a) - this._rankOpenAIImageModel(b) || a.id.localeCompare(b.id));
        return {
            endpoint,
            models: imageModels.length ? imageModels : allModels,
            allModels,
            filtered: imageModels.length > 0
        };
    }

    _getOpenAIImageSize(model, width, height) {
        const modelName = String(model || '').trim().toLowerCase();
        const w = Number(width) || 1024;
        const h = Number(height) || 1024;
        const ratio = w / Math.max(1, h);
        if (/^dall-e-3$/i.test(modelName)) {
            if (ratio > 1.2) return '1792x1024';
            if (ratio < 0.8) return '1024x1792';
            return '1024x1024';
        }
        if (/^dall-e-2$/i.test(modelName)) {
            return '1024x1024';
        }
        if (ratio > 1.2) return '1536x1024';
        if (ratio < 0.8) return '1024x1536';
        return '1024x1024';
    }

    _normalizeOpenAIImageQuality(model, quality) {
        const modelName = String(model || '').trim().toLowerCase();
        const value = String(quality || 'auto').trim().toLowerCase();
        if (!value || value === 'auto') return '';
        if (modelName === 'dall-e-3') {
            return value === 'high' ? 'hd' : 'standard';
        }
        if (modelName === 'dall-e-2') return '';
        return ['low', 'medium', 'high'].includes(value) ? value : '';
    }

    _normalizeSdLoraPrompt(value) {
        return String(value || '')
            .split(/[\n,，]+/)
            .map(item => item.trim())
            .filter(Boolean)
            .map((item) => {
                if (/^<lora:[^>]+>$/i.test(item)) return item;
                const match = item.match(/^(.+?)(?:[:：]\s*([0-9.]+))?$/);
                const name = String(match?.[1] || item).trim();
                const weight = Number.parseFloat(match?.[2]);
                const safeWeight = Number.isFinite(weight) ? Math.max(0, Math.min(2, weight)) : 1;
                return name ? `<lora:${name}:${safeWeight}>` : '';
            })
            .filter(Boolean)
            .join(', ');
    }

    async _generateStableDiffusion(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const baseUrl = this._normalizeSdBaseUrl(config.sdUrl);
        if (!baseUrl) throw new Error('未配置 Stable Diffusion 服务地址');

        const appKey = String(options.app || '').trim().toLowerCase();
        const appDefaults = this._getAppDefaultSize(appKey);
        let width = Number(options.width || config.width);
        let height = Number(options.height || config.height);
        let steps = Number(options.steps || config.steps);
        let scale = Number(options.scale ?? config.scale);
        const seed = Number(options.seed ?? config.seed);
        const cfgRescale = Number(options.cfgRescale ?? config.cfgRescale);

        if (appKey === 'honey') {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width < 512 || height < 768) {
                width = appDefaults.width;
                height = appDefaults.height;
            }
            if (!Number.isFinite(steps) || steps < 20) steps = 28;
            if (!Number.isFinite(scale) || scale < 1) scale = 7;
        }

        const modelName = String(config.model || '').trim();
        const modelHash = await this.getSdModelHash(baseUrl, modelName).catch(() => null);
        const loraPrompt = this._normalizeSdLoraPrompt(config.sdLora);
        const positivePrompt = this._joinPrompt([config.fixedPrompt, loraPrompt, prompt, config.fixedPromptEnd]);
        const negativePrompt = this._joinPrompt([config.negativePrompt, options.negativePrompt]);
        const sdReferenceImages = this._normalizeSdReferenceImages(options);
        const useImg2Img = sdReferenceImages.length > 0;
        const payload = {
            prompt: positivePrompt,
            negative_prompt: negativePrompt,
            width,
            height,
            steps,
            cfg_scale: scale,
            seed: Number.isFinite(seed) && seed >= 0 ? Math.floor(seed) : -1,
            sampler_name: String(config.sampler || 'Euler a').trim() || 'Euler a',
            batch_size: 1,
            n_iter: 1,
            restore_faces: Boolean(config.sdRestoreFaces)
        };
        if (useImg2Img) {
            payload.init_images = sdReferenceImages;
            payload.denoising_strength = this._clampReferenceValue(
                options.denoisingStrength ?? options.sdDenoisingStrength ?? config.sdDenoisingStrength,
                0.45,
                0,
                1
            );
        }

        const overrideSettings = {};
        if (modelName) {
            overrideSettings.sd_model_checkpoint = modelName;
        }
        if (config.sdVae) {
            overrideSettings.sd_vae = config.sdVae;
        }
        if (Number(config.sdClipSkip) > 0) {
            overrideSettings.CLIP_stop_at_last_layers = Math.round(Number(config.sdClipSkip));
        }
        if (Object.keys(overrideSettings).length > 0) {
            payload.override_settings = overrideSettings;
        }
        if (cfgRescale > 0) {
            payload.cfg_rescale = cfgRescale;
        }
        if (config.sdScheduler) {
            payload.scheduler = config.sdScheduler;
        }
        if (config.sdHiresFix && !useImg2Img) {
            payload.enable_hr = true;
            payload.hr_scale = Number(config.sdUpscaleFactor) || 1.5;
            payload.hr_second_pass_steps = Math.max(0, Math.round(Number(config.sdHiresSteps) || 0));
            payload.denoising_strength = Number(config.sdDenoisingStrength) || 0.45;
            if (config.sdUpscaler) payload.hr_upscaler = config.sdUpscaler;
        }
        if (config.sdADetailer) {
            payload.alwayson_scripts = {
                ...(payload.alwayson_scripts || {}),
                ADetailer: {
                    args: [
                        true,
                        false,
                        {
                            ad_model: 'face_yolov8n.pt'
                        }
                    ]
                }
            };
        }

        let result = null;
        if (this._isSillyTavern() && !useImg2Img) {
            try {
                const response = await this._sdProxyRequest('generate', { ...payload, url: baseUrl });
                if (response.ok) {
                    const proxyResult = await response.json().catch(() => null);
                    if (proxyResult && (proxyResult.images || proxyResult.image || proxyResult.result)) {
                        result = proxyResult;
                    }
                } else {
                    const text = await response.text().catch(() => '');
                    console.warn('[SD] 代理生图失败，尝试直连:', response.status, text);
                }
            } catch (err) {
                console.warn('[SD] 代理生图异常，尝试直连:', err);
            }
        }

        if (!result) {
            const endpoints = useImg2Img
                ? ['/sdapi/v1/img2img', '/api/img2img']
                : ['/sdapi/v1/txt2img', '/api/txt2img'];
            let lastError = '';
            for (const endpoint of endpoints) {
                try {
                    const response = await this._sdDirectRequest(`${baseUrl}${endpoint}`, {
                        method: 'POST',
                        headers: this._buildSdHeaders({
                            'Content-Type': 'application/json',
                            Accept: 'application/json'
                        }, config),
                        body: JSON.stringify(payload)
                    });
                    const text = await response.text();
                    const parsed = text ? JSON.parse(text) : null;
                    if (response.ok && parsed && (parsed.images || parsed.image || parsed.result)) {
                        result = parsed;
                        break;
                    }
                    lastError = `HTTP ${response.status}: ${endpoint}`;
                    if (parsed?.error || parsed?.message) {
                        lastError += ` ${String(parsed.error?.message || parsed.message || parsed.error).slice(0, 180)}`;
                    }
                } catch (err) {
                    lastError = `${endpoint}: ${err?.message || err}`;
                }
            }
            if (!result) {
                throw new Error(`Stable Diffusion 请求失败${lastError ? `: ${lastError}` : ''}`);
            }
        }

        const imageData = this._extractSdImage(result);
        if (!imageData) throw new Error('Stable Diffusion 未返回可用图片');
        const imageInfo = await this._waitForImageDecode(imageData).catch((err) => {
            throw new Error(`SD 返回图片不可用: ${err?.message || err}`);
        });

        return {
            provider: 'sd',
            model: modelName,
            modelHash,
            prompt,
            width: imageInfo.width,
            height: imageInfo.height,
            requestedWidth: width,
            requestedHeight: height,
            steps,
            sampler: payload.sampler_name,
            scale,
            seed: payload.seed,
            imageData,
            imageUrl: imageData
        };
    }

    async _generateNovelAI(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const endpoint = `${this._resolveNovelAIEndpoint(config)}/ai/generate-image`;
        const payload = this._buildNovelAIPayload(options, config);
        this._debugNovelAIRequest({ endpoint, payload, config, options });
        const queueInfo = await this._waitForNovelAIQueueTurn(config, options);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/x-zip-compressed, image/png, application/json'
                },
                body: JSON.stringify(payload),
                signal: options.signal
            });

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                const hint = response.status >= 500
                    ? `；当前参数 model=${config.model}, sampler=${config.sampler}, schedule=${config.schedule}，可先用 native + k_euler 测试`
                    : '';
                throw new Error(`NovelAI 请求失败 (${response.status})${hint}${text ? `: ${text.slice(0, 180)}` : ''}`);
            }

            const contentType = String(response.headers.get('content-type') || '').toLowerCase();
            let imageData = '';
            if (contentType.includes('application/json')) {
                const payload = await response.json();
                imageData = this._extractBase64Image(payload);
            } else {
                imageData = await this._readZipImage(response);
            }
            if (!imageData) throw new Error('NovelAI 未返回可用图片');
            const imageInfo = await this._waitForImageDecode(imageData).catch((err) => {
                throw new Error(`NovelAI 返回图片不可用: ${err?.message || err}`);
            });
            return {
                provider: 'novelai',
                model: config.model,
                prompt,
                width: imageInfo.width,
                height: imageInfo.height,
                requestedWidth: Number(payload?.parameters?.width || config.width),
                requestedHeight: Number(payload?.parameters?.height || config.height),
                steps: Number(payload?.parameters?.steps || config.steps),
                sampler: config.sampler,
                schedule: config.schedule,
                scale: Number(payload?.parameters?.scale ?? config.scale),
                seed: Number(payload?.parameters?.seed ?? -1),
                imageData,
                imageUrl: imageData
            };
        } finally {
            await this._finishNovelAIQueue(queueInfo);
        }
    }

    async _generateSiliconflow(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const response = await fetch('https://api.siliconflow.cn/v1/images/generations', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.model,
                prompt: this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd], '，'),
                negative_prompt: this._joinPrompt([config.negativePrompt, options.negativePrompt]),
                image_size: `${Number(options.width || config.width)}x${Number(options.height || config.height)}`,
                batch_size: 1,
                num_inference_steps: Number(options.steps || config.steps),
                guidance_scale: Number(options.scale ?? config.scale)
            })
        });
        const text = await response.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (!response.ok) {
            const msg = payload?.message || payload?.error?.message || payload?.error || text || '';
            throw new Error(`SiliconFlow 请求失败 (${response.status})${msg ? `: ${String(msg).slice(0, 180)}` : ''}`);
        }
        const imageUrl = String(payload?.images?.[0]?.url || '').trim();
        if (!imageUrl) throw new Error('SiliconFlow 未返回图片 URL');
        return {
            provider: 'siliconflow',
            model: config.model,
            prompt,
            width: Number(options.width || config.width),
            height: Number(options.height || config.height),
            requestedWidth: Number(options.width || config.width),
            requestedHeight: Number(options.height || config.height),
            steps: Number(options.steps || config.steps),
            scale: Number(options.scale ?? config.scale),
            imageData: imageUrl,
            imageUrl
        };
    }

    async _generateOpenAIImage(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');
        if (!String(config.apiKey || '').trim()) throw new Error('请先填写 GPT 生图 API Key');

        const width = Number(options.width || config.width);
        const height = Number(options.height || config.height);
        const model = String(config.model || 'gpt-image-2').trim() || 'gpt-image-2';
        const requestedSize = this._getOpenAIImageSize(model, width, height);
        const endpoint = this._resolveOpenAIEndpoint(config);
        const payload = {
            model,
            prompt: this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd], '\n'),
            size: requestedSize,
            n: 1
        };
        const normalizedQuality = this._normalizeOpenAIImageQuality(model, config.openaiQuality);
        if (normalizedQuality) {
            payload.quality = normalizedQuality;
        }
        const negativePrompt = this._joinPrompt([config.negativePrompt, options.negativePrompt]);
        if (negativePrompt) {
            payload.prompt = `${payload.prompt}\n\nAvoid: ${negativePrompt}`;
        }

        let response = null;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: options.signal
            });
        } catch (err) {
            const message = String(err?.message || err || '').trim();
            if (/failed to fetch|networkerror|load failed/i.test(message)) {
                const siteLabel = config.openaiSite === 'public'
                    ? 'GPT 公益站'
                    : (config.openaiSite === 'custom' ? 'GPT 自定义站点' : 'OpenAI 官方站点');
                throw new Error(`${siteLabel} 请求被浏览器拦截或网络失败。若控制台提示 CORS，说明该站点没有给当前页面返回 Access-Control-Allow-Origin；测试短提示词成功但微信生图失败时，通常是实际提示词触发了站点错误响应，而错误响应未带 CORS。请让公益站开启 CORS，或换支持浏览器跨域的中转站。`);
            }
            throw err;
        }
        const text = await response.text();
        let result = null;
        try { result = text ? JSON.parse(text) : null; } catch (e) { result = null; }
        if (!response.ok) {
            const msg = result?.error?.message || result?.message || result?.error || text || '';
            throw new Error(`GPT 生图请求失败 (${response.status})${msg ? `: ${String(msg).slice(0, 180)}` : ''}`);
        }
        const imageData = this._extractOpenAIImage(result);
        if (!imageData) throw new Error('GPT 生图未返回可用图片');
        const imageInfo = imageData.startsWith('data:image/')
            ? await this._waitForImageDecode(imageData).catch(() => ({ width: 0, height: 0 }))
            : { width: 0, height: 0 };
        const [requestedWidth, requestedHeight] = requestedSize.split('x').map(Number);
        return {
            provider: 'openai',
            model,
            prompt,
            width: imageInfo.width || requestedWidth || width,
            height: imageInfo.height || requestedHeight || height,
            requestedWidth: requestedWidth || width,
            requestedHeight: requestedHeight || height,
            quality: normalizedQuality || config.openaiQuality || 'auto',
            imageData,
            imageUrl: imageData
        };
    }
}
