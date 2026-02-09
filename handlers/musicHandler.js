// handlers/musicHandler.js - Versión ESTABLE + VOLUMEN ALTO + RECORTE POR TIEMPO 2026
// Soporte para .yt nombre/link  [inicio] [fin]  → recorta segmento
// Ejemplo: .yt bad bunny un x100to 1:20 2:05

import youtubedl from 'youtube-dl-exec'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import fetch from 'node-fetch'
import tmp from 'tmp-promise'
import fs from 'fs-extra'

ffmpeg.setFfmpegPath(ffmpegStatic)

console.log('[musicHandler] Cargado OK - VOLUMEN FUERTE + RECORTE POR TIEMPO 2026')

const MAX_DURATION_SEC = 600
const MAX_SIZE_MB_APROX = 16

// Función auxiliar: convierte "mm:ss" a segundos
function timeToSeconds(timeStr) {
    if (!timeStr) return null
    const parts = timeStr.split(':').map(Number)
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1]
    }
    if (parts.length === 1) {
        return parts[0]
    }
    return null
}

export async function handleMusic(message, sock, config) {
    const { key, message: msg } = message
    const jid = key.remoteJid

    let text = ''
    if (msg?.conversation) text = msg.conversation.trim()
    else if (msg?.extendedTextMessage?.text) text = msg.extendedTextMessage.text.trim()

    if (!text) return

    const lower = text.toLowerCase().trim()
    const prefixes = ['.yt', '.play', '.p']
    const matchedPrefix = prefixes.find(p => lower.startsWith(p + ' ') || lower === p)

    if (!matchedPrefix) return

    // Quitamos el prefijo y limpiamos
    let fullQuery = text.slice(matchedPrefix.length).trim()

    // Separamos posibles tiempos al final
    const parts = fullQuery.split(/\s+/)
    let query = ''
    let startTime = null
    let endTime = null

    if (parts.length >= 3) {
        // Últimos dos argumentos podrían ser tiempos
        const maybeEnd = parts.pop()
        const maybeStart = parts.pop()
        const startSec = timeToSeconds(maybeStart)
        const endSec = timeToSeconds(maybeEnd)

        if (startSec !== null && endSec !== null && endSec > startSec) {
            startTime = startSec
            endTime = endSec
            query = parts.join(' ').trim()
        } else {
            // No eran tiempos válidos → todo es query
            query = fullQuery
        }
    } else {
        query = fullQuery
    }

    if (!query) {
        await sock.sendMessage(jid, { text: 'Ejemplo:\n.yt bad bunny un x100to\n.yt https://youtu.be/xxxx 1:20 2:05' })
        return
    }

    console.log(`[music] Comando: ${matchedPrefix} | Query: "${query}" | Start: ${startTime}s | End: ${endTime}s`)

    let tempInputFile = null
    let tempOutputFile = null

    try {
        let audioUrl
        let title = 'Sin título'
        let duration = 0

        const commonOpts = {
            noPlaylist: true,
            noWarnings: true,
            preferFreeFormats: true,
            format: '251/250/249/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
            addHeader: [
                'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
                'Referer:https://www.youtube.com/'
            ]
        }

        const isLink = /^https?:\/\//i.test(query) || /youtu\.?be/i.test(query)

        if (!isLink) {
            // BÚSQUEDA POR NOMBRE
            console.log('[music] BÚSQUEDA por nombre')
            const searchOpts = { ...commonOpts, defaultSearch: 'ytsearch1', dumpSingleJson: true, flatPlaylist: true }
            const searchResult = await youtubedl(query, searchOpts)

            let videoId = null

            if (searchResult.entries && searchResult.entries.length > 0) {
                const entry = searchResult.entries[0]
                videoId = entry.id || entry.url?.split('v=')[1]?.split('&')[0]
                title = entry.title || entry.fulltitle || 'Primer resultado'
                duration = entry.duration || 0
            } else if (searchResult.id) {
                videoId = searchResult.id
                title = searchResult.title || searchResult.fulltitle || 'Resultado'
                duration = searchResult.duration || 0
            }

            if (!videoId || videoId.length < 8) {
                throw new Error('No se encontró video válido en la búsqueda')
            }

            videoId = videoId.trim().replace(/[^a-zA-Z0-9_-]/g, '')

            const constructedUrl = `https://www.youtube.com/watch?v=${videoId}`
            console.log('[music] URL construida:', constructedUrl)

            const infoOpts = { ...commonOpts, dumpSingleJson: true }
            const info = await youtubedl(constructedUrl, infoOpts)

            audioUrl = info.url || info.formats?.find(f => f.ext === 'webm' || f.ext === 'm4a')?.url
            title = info.title || title
            duration = info.duration || duration
        } else {
            // LINK DIRECTO
            console.log('[music] LINK directo')
            const info = await youtubedl(query, { ...commonOpts, dumpSingleJson: true })
            title = info.title || 'Sin título'
            duration = info.duration || 0
            audioUrl = info.url || info.formats?.find(f => f.ext === 'webm' || f.ext === 'm4a')?.url
        }

        if (!audioUrl) throw new Error('No se encontró URL de audio válida')

        const min = Math.floor(duration / 60)
        const sec = duration % 60
        const durationStr = duration > 0 
            ? `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
            : '?'

        if (duration > MAX_DURATION_SEC && duration > 0) {
            await sock.sendMessage(jid, { text: `⛔ Muy largo (${durationStr}) — máximo 10 min` })
            return
        }

        let segmentInfo = ''
        if (startTime !== null && endTime !== null) {
            const segDuration = endTime - startTime
            segmentInfo = ` (segmento ${startTime}s → ${endTime}s, dur: ${segDuration}s)`
        }

        await sock.sendMessage(jid, {
            text: `🎵 ${title.slice(0, 50)}${title.length > 50 ? '...' : ''}\nDur: ${durationStr}${segmentInfo}\nDescargando...`
        })

        const res = await fetch(audioUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!res.ok) throw new Error(`Descarga fallida: ${res.status}`)

        tempInputFile = await tmp.file({ postfix: '.webm' })
        const inputPath = tempInputFile.path

        const writeStream = fs.createWriteStream(inputPath)
        res.body.pipe(writeStream)

        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve)
            writeStream.on('error', reject)
        })

        console.log('[music] Descarga OK:', inputPath)

        // ──────────────────────────────────────────────
        // CONVERSIÓN + RECORTE SI HAY TIEMPOS
        // ──────────────────────────────────────────────
        tempOutputFile = await tmp.file({ postfix: '.ogg' })
        const outputPath = tempOutputFile.path

        const ffmpegCmd = ffmpeg(inputPath)
            .noVideo()
            .audioCodec('libopus')
            .audioBitrate(64)
            .audioChannels(1)
            .audioFrequency(48000)

        // Si hay recorte, aplicamos ss y to
        if (startTime !== null) {
            ffmpegCmd.seekInput(startTime)
        }
        if (endTime !== null) {
            ffmpegCmd.duration(endTime - startTime)
        }

        await new Promise((resolve, reject) => {
            ffmpegCmd
                .audioFilters(
                    'loudnorm=I=-12:TP=-0.5:LRA=7:linear=true,' +
                    'compand=attacks=0.03:decays=0.25:points=-70/-70|-20/-15|0/-8|20/-8,' +
                    'volume=1.8,' +
                    'afftdn=nr=12:nf=-35:tn=1'
                )
                .format('ogg')
                .outputOptions([
                    '-vbr', 'on',
                    '-compression_level', '10',
                    '-frame_duration', '20',
                    '-application', 'voip'
                ])
                .on('start', cmd => console.log('[music] FFmpeg cmd:', cmd))
                .on('progress', p => {
                    if (p.percent) console.log('[music] Progreso:', p.percent.toFixed(1) + '%')
                })
                .on('error', (err, stdout, stderr) => {
                    console.error('[music] FFmpeg error:', err.message || err)
                    if (stderr) console.error('[music] stderr:', stderr.slice(0, 800))
                    reject(err)
                })
                .on('end', () => {
                    console.log('[music] Conversión terminada OK')
                    resolve()
                })
                .save(outputPath)
        })

        console.log('[music] Conversión OK:', outputPath)

        const audioBuffer = await fs.readFile(outputPath)

        if (audioBuffer.length > MAX_SIZE_MB_APROX * 1024 * 1024) {
            await sock.sendMessage(jid, { text: `Pesado (${(audioBuffer.length / (1024*1024)).toFixed(1)} MB)` })
            return
        }

        await sock.sendMessage(jid, {
            audio: audioBuffer,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true,
            fileName: `${title.replace(/[^a-z0-9]/gi, '_')}.ogg`
        })

        console.log(`[music] ENVIADO → ${title} (${(audioBuffer.length / 1024).toFixed(1)} KB)`)

        await sock.sendMessage(jid, { 
            text: `✅ Enviado (volumen alto y limpio)${segmentInfo ? ' — segmento recortado' : ''}\nTítulo: ${title}\nDur: ${durationStr}` 
        })

    } catch (err) {
        console.error('[music] ERROR FINAL:', err.message || err)
        await sock.sendMessage(jid, { 
            text: '❌ Falló la descarga o conversión.\nPrueba con nombre más específico o link directo.'
        })
    } finally {
        if (tempInputFile) await tempInputFile.cleanup().catch(() => {})
        if (tempOutputFile) await tempOutputFile.cleanup().catch(() => {})
    }
}