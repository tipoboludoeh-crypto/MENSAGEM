// handlers/tiktokHandler.js - TikTok Downloader ULTRA ESTABLE 2026
// .tt4 [link] → video MP4 sin watermark
// .tt3 [link] → audio como nota de voz

import fetch from 'node-fetch'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import tmp from 'tmp-promise'
import fs from 'fs-extra'

ffmpeg.setFfmpegPath(ffmpegStatic)

console.log('[tiktokHandler] Cargado OK - ULTRA ESTABLE 2026 (tt4 video + tt3 audio)')

// Intentamos varias APIs y métodos para máxima compatibilidad
const TIKTOK_APIS = [
  'https://tikwm.com/api/',
  'https://api.tiklydown.eu.org/api/download',
  'https://tikdown.org/api/ajaxSearch'
]

export async function handleTikTok(message, sock, config) {
    const { key, message: msg } = message
    const jid = key.remoteJid

    let text = ''
    if (msg?.conversation) text = msg.conversation.trim()
    else if (msg?.extendedTextMessage?.text) text = msg.extendedTextMessage.text.trim()

    if (!text) return

    const lower = text.toLowerCase().trim()
    const prefixes = ['.tt4', '.tt3']
    const matchedPrefix = prefixes.find(p => lower.startsWith(p + ' ') || lower === p)

    if (!matchedPrefix) return

    const url = text.slice(matchedPrefix.length).trim()

    if (!url || !url.includes('tiktok.com')) {
        await sock.sendMessage(jid, { text: 'Ejemplo correcto:\n.tt4 https://vt.tiktok.com/ZSm1WeKf4/\n.tt3 https://vm.tiktok.com/Zxxxx/' })
        return
    }

    console.log(`[tiktok] Comando: ${matchedPrefix} | URL: ${url}`)

    let tempInputFile = null
    let tempOutputFile = null

    try {
        await sock.sendMessage(jid, { text: '🔄 Descargando TikTok... (puede tardar unos segundos)' })

        // 1. Intentamos obtener datos del video con varias APIs
        let videoData = null
        let videoUrl = null
        let audioUrl = null

        for (const api of TIKTOK_APIS) {
            try {
                const res = await fetch(`${api}?url=${encodeURIComponent(url)}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                })
                const json = await res.json()

                if (json.data?.play || json.data?.noWaterMark || json.data?.hdplay) {
                    videoData = json.data
                    videoUrl = json.data.play || json.data.noWaterMark || json.data.hdplay
                    audioUrl = json.data.music || json.data.originalAudio
                    break
                }
            } catch (e) {
                console.log(`[tiktok] API ${api} falló, intentando siguiente...`)
            }
        }

        if (!videoUrl && !audioUrl) {
            throw new Error('No se pudo obtener enlace de descarga (TikTok bloqueó o cambió formato)')
        }

        if (matchedPrefix === '.tt4') {
            // VIDEO MP4
            if (!videoUrl) throw new Error('No video disponible sin watermark')

            const res = await fetch(videoUrl)
            if (!res.ok) throw new Error(`Descarga video: ${res.status}`)

            const videoBuffer = Buffer.from(await res.arrayBuffer())

            await sock.sendMessage(jid, {
                video: videoBuffer,
                mimetype: 'video/mp4',
                caption: 'Video de TikTok (sin watermark)'
            })

            console.log('[tiktok] Video MP4 enviado')
        } else if (matchedPrefix === '.tt3') {
            // AUDIO → nota de voz
            if (!audioUrl) throw new Error('No audio disponible')

            const res = await fetch(audioUrl)
            if (!res.ok) throw new Error(`Descarga audio: ${res.status}`)

            tempInputFile = await tmp.file({ postfix: '.m4a' })
            const inputPath = tempInputFile.path

            const writeStream = fs.createWriteStream(inputPath)
            res.body.pipe(writeStream)

            await new Promise((r, j) => {
                writeStream.on('finish', r)
                writeStream.on('error', j)
            })

            console.log('[tiktok] Audio descargado:', inputPath)

            tempOutputFile = await tmp.file({ postfix: '.ogg' })
            const outputPath = tempOutputFile.path

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .noVideo()
                    .audioCodec('libopus')
                    .audioBitrate(48)
                    .audioChannels(1)
                    .audioFrequency(48000)
                    .format('ogg')
                    .outputOptions([
                        '-vbr', 'on',
                        '-compression_level', '10',
                        '-frame_duration', '20'
                    ])
                    .on('start', cmd => console.log('[tiktok] FFmpeg cmd:', cmd))
                    .on('error', (err, stdout, stderr) => {
                        console.error('[tiktok] FFmpeg error:', err.message)
                        reject(err)
                    })
                    .on('end', resolve)
                    .save(outputPath)
            })

            const audioBuffer = await fs.readFile(outputPath)

            await sock.sendMessage(jid, {
                audio: audioBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            })

            console.log('[tiktok] Audio como nota de voz enviado')
        }

        await sock.sendMessage(jid, { text: '✅ Descarga de TikTok completada' })

    } catch (err) {
        console.error('[tiktok] ERROR FINAL:', err.message || err)
        await sock.sendMessage(jid, {
            text: '❌ No pude descargar este TikTok.\nRazones comunes:\n• Video privado/restringido\n• Link inválido\n• TikTok cambió su formato\n\nPrueba otro video o link completo.'
        })
    } finally {
        if (tempInputFile) await tempInputFile.cleanup().catch(() => {})
        if (tempOutputFile) await tempOutputFile.cleanup().catch(() => {})
    }
}