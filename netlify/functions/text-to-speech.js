// Text-to-Speech using ElevenLabs
const { authorize } = require('./_auth');
const { checkQuota } = require('./_usage');
const { requireCsrfHeader } = require('./_csrf');

exports.handler = async (event) => {
    const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
    const corsHeaders = {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: 'Method not allowed' };
    }

    // CSRF protection — prevents cross-origin abuse
    const csrfBlock = requireCsrfHeader(event);
    if (csrfBlock) return csrfBlock;

    // 1. Check Auth (Staff get unlimited/VIP)
    const auth = await authorize(event);
    
    // 2. If not staff, enforce the public daily circuit breaker
    if (!auth.ok) {
        const hasQuota = await checkQuota('elevenlabs_public');
        if (!hasQuota) {
            console.error('[WALLET PROTECTION] ElevenLabs daily budget exceeded.');
            return { 
                statusCode: 429, 
                body: JSON.stringify({ error: 'Daily voice quota reached. Come back tomorrow!' }) 
            };
        }
        // Public access allowed under quota — no auth required for TTS
    }

    try {
        const { text } = JSON.parse(event.body);
        
        if (!text) {
            return { statusCode: 400, headers: corsHeaders, body: 'No text provided' };
        }

        // Limit text length to prevent cost amplification
        const MAX_TTS_LENGTH = 500;
        const safeText = String(text).slice(0, MAX_TTS_LENGTH);

        // Use Elise's voice (or a default ElevenLabs voice)
        const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah voice as fallback
        
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVENLABS_API_KEY
            },
            body: JSON.stringify({
                text: safeText,
                model_id: 'eleven_turbo_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            })
        });

        if (!response.ok) {
            console.error('ElevenLabs TTS error:', response.status);
            return { statusCode: 500, headers: corsHeaders, body: 'TTS failed' };
        }

        const audioBuffer = await response.arrayBuffer();
        
        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'no-cache'
            },
            body: Buffer.from(audioBuffer).toString('base64'),
            isBase64Encoded: true
        };
    } catch (error) {
        console.error('TTS error:', error);
        return { statusCode: 500, headers: corsHeaders, body: 'TTS error' };
    }
};
