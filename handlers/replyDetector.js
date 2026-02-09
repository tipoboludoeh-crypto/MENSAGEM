import { 
    downloadMediaMessage, 
    downloadContentFromMessage 
} from '@whiskeysockets/baileys';

// 🎯 CONFIGURACIÓN
const TOGGLE_PREFIX = '.';  // Cambia a '!' o lo que quieras
let isOnceViewActive = false; // Empieza DESACTIVADO por seguridad

// 📊 Función para formatear tamaño
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 🎯 MANEJADOR PRINCIPAL
export async function handleMessage(message, sock, config) {
    try {
        const { key, message: msg } = message;
        const jid = key.remoteJid;
        const fromMe = key.fromMe;

        // 🎯 1. PROCESAR COMANDOS DE TOGGLE (solo si es mensaje mío)
        if (fromMe) {
            // Obtener texto
            let text = '';
            if (msg?.conversation) {
                text = msg.conversation.trim();
            } else if (msg?.extendedTextMessage?.text) {
                text = msg.extendedTextMessage.text.trim();
            }
            
            // Si empieza con el prefijo, es comando
            if (text.toLowerCase().startsWith(TOGGLE_PREFIX)) {
                const command = text.slice(TOGGLE_PREFIX.length).trim().toLowerCase();
                
                // ACTIVAR
                if (command === 'onov') {
                    isOnceViewActive = true;
                    console.log('\n╔════════════════════════════╗');
                    console.log('║        🟢 ACTIVADO         ║');
                    console.log('╚════════════════════════════╝');
                    console.log('📡 Modo: DETECCIÓN ACTIVADA');
                    console.log('💡 Responde a view-once para extraer');
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                    
                    // Mensaje de confirmación en WhatsApp
                    await sock.sendMessage(config.bot.owner, {
                        text: '🟢 *MODO ACTIVADO*\n\nAhora extraeré view-once automáticamente cuando respondas a ellos.'
                    });
                    return;
                }
                
                // DESACTIVAR
                if (command === 'offov') {
                    isOnceViewActive = false;
                    console.log('\n╔════════════════════════════╗');
                    console.log('║        🔴 DESACTIVADO      ║');
                    console.log('╚════════════════════════════╝');
                    console.log('📴 Modo: DETECCIÓN DESACTIVADA');
                    console.log('🚫 Ignorando todas las respuestas');
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                    
                    // Mensaje de confirmación en WhatsApp
                    await sock.sendMessage(config.bot.owner, {
                        text: '🔴 *MODO DESACTIVADO*\n\nNo extraeré view-once. Usa .onov para reactivar.'
                    });
                    return;
                }
                
                // ESTADO
                if (command === 'status' || command === 'estado') {
                    const status = isOnceViewActive ? '🟢 ACTIVADO' : '🔴 DESACTIVADO';
                    console.log('\n╔════════════════════════════╗');
                    console.log('║        📊 ESTADO           ║');
                    console.log('╚════════════════════════════╝');
                    console.log(`Modo: ${status}`);
                    console.log(`Prefijo: "${TOGGLE_PREFIX}"`);
                    console.log(`Owner: ${config.bot.owner.split('@')[0]}`);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                    
                    await sock.sendMessage(config.bot.owner, {
                        text: `📊 *ESTADO*\n\nModo: ${status}\nPrefijo: "${TOGGLE_PREFIX}"`
                    });
                    return;
                }
            }
        }
        
        // 🎯 2. SI ESTÁ DESACTIVADO → IGNORAR TODO
        if (!isOnceViewActive) {
            return; // Silencio total, sin logs
        }
        
        // 🎯 3. SOLO PROCESAR SI ES MI RESPUESTA
        if (!fromMe) {
            return;
        }
        
        // 🎯 4. DEBE SER RESPUESTA CON QUOTED
        if (!msg?.extendedTextMessage?.contextInfo?.quotedMessage) {
            return;
        }
        
        console.log('\n🎯 RESPUESTA DETECTADA → Buscando view-once...');
        
        const quotedCtx = msg.extendedTextMessage.contextInfo;
        const quoted = quotedCtx.quotedMessage;
        
        // 🎯 5. DETECTAR MEDIO
        let mediaType = null;
        let mediaObject = null;
        
        // Detección exhaustiva
        if (quoted.imageMessage) {
            mediaType = 'image';
            mediaObject = quoted.imageMessage;
            console.log('📸 Imagen detectada');
        } 
        else if (quoted.videoMessage) {
            mediaType = 'video';
            mediaObject = quoted.videoMessage;
            console.log('🎥 Video detectado');
        }
        else if (quoted.ephemeralMessage?.message?.viewOnceMessage?.message) {
            const inner = quoted.ephemeralMessage.message.viewOnceMessage.message;
            if (inner.imageMessage) {
                mediaType = 'image';
                mediaObject = inner.imageMessage;
                console.log('📸 View-once (ephemeral) detectado');
            } else if (inner.videoMessage) {
                mediaType = 'video';
                mediaObject = inner.videoMessage;
                console.log('🎥 Video view-once (ephemeral) detectado');
            }
        }
        else if (quoted.viewOnceMessage?.message) {
            const inner = quoted.viewOnceMessage.message;
            if (inner.imageMessage) {
                mediaType = 'image';
                mediaObject = inner.imageMessage;
                console.log('📸 View-once detectado');
            } else if (inner.videoMessage) {
                mediaType = 'video';
                mediaObject = inner.videoMessage;
                console.log('🎥 Video view-once detectado');
            }
        }
        
        if (!mediaObject) {
            console.log('⚠️  No es view-once/imagen/video - ignorando');
            return;
        }
        
        // 🎯 6. DESCARGA
        console.log('⬇️  Descargando...');
        
        let buffer = null;
        
        // Método 1: downloadMediaMessage
        try {
            buffer = await downloadMediaMessage(
                {
                    key: {
                        remoteJid: jid,
                        id: quotedCtx.stanzaId || key.id,
                        participant: quotedCtx.participant,
                        fromMe: false
                    },
                    message: quoted
                },
                'buffer',
                {},
                {
                    reuploadRequest: sock.updateMediaMessage,
                    timeout: 15000
                }
            );
            
            if (buffer && buffer.length > 1024) {
                console.log(`✅ Descargado: ${formatFileSize(buffer.length)}`);
            } else {
                throw new Error('Buffer pequeño');
            }
            
        } catch (error1) {
            // Método 2: downloadContentFromMessage
            try {
                const stream = await downloadContentFromMessage(mediaObject, mediaType);
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                buffer = Buffer.concat(chunks);
                console.log(`✅ Descarga alternativa: ${formatFileSize(buffer.length)}`);
            } catch (error2) {
                console.log('❌ Error en descarga:', error2.message);
                return;
            }
        }
        
        if (!buffer || buffer.length < 1024) {
            console.log('⚠️  Archivo muy pequeño - ignorando');
            return;
        }
        
        // 🎯 7. FILTRO POR TAMAÑO (para ignorar thumbnails)
        const sizeKB = buffer.length / 1024;
        if ((mediaType === 'image' && sizeKB < 20) || (mediaType === 'video' && sizeKB < 80)) {
            console.log(`⚠️  Demasiado pequeño (${sizeKB.toFixed(1)} KB) - probablemente normal`);
            return;
        }
        
        console.log(`📊 Tamaño: ${formatFileSize(buffer.length)} | OK para enviar`);
        
        // 🎯 8. ENVÍO SILENCIOSO (sin caption, solo archivo)
        console.log('📤 Enviando a tu chat privado (silencioso)...');
        
        try {
            const mimeType = mediaObject.mimetype || 
                            (mediaType === 'image' ? 'image/jpeg' : 'video/mp4');
            
            // 🎯 ENVÍO SIN CAPTION - TOTALMENTE SILENCIOSO
            await sock.sendMessage(config.bot.owner, {
                [mediaType]: buffer,
                mimetype: mimeType
                // Sin caption - totalmente silencioso
            });
            
            console.log('✨ ENVIADO EXITOSAMENTE (silencioso)');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
        } catch (sendError) {
            console.log(`❌ Error al enviar: ${sendError.message}`);
            
            // Fallback silencioso
            try {
                await sock.sendMessage(config.bot.owner, {
                    document: buffer,
                    mimetype: mediaObject.mimetype || 'application/octet-stream',
                    fileName: `v_${Date.now()}.${mediaType === 'image' ? 'jpg' : 'mp4'}`
                });
                console.log('📄 Enviado como documento (fallback silencioso)\n');
            } catch (docError) {
                console.log('💀 Error total en envío\n');
            }
        }
        
    } catch (error) {
        console.log(`💀 Error general: ${error.message}\n`);
    }
}