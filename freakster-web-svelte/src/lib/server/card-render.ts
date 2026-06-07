import { Resvg } from '@resvg/resvg-js';
import QRCode from 'qrcode';

import {
	normalizeReleaseDate,
	slugifyFileName,
	type SongCardData,
	type SongCardImageBytes
} from '$lib/types/song-card';

// Colors mirror src/routes/layout.css tokens converted from OKLCH to sRGB hex.
// --bg oklch(0.12 0.008 350) ≈ #1a1417   --primary oklch(0.65 0.16 350) ≈ #d8628f
const NOIR_BG = '#1a1417';
const ROSE_PRIMARY = '#d8628f';

const FRONT_DEFS = `
    <filter id="pinkGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="22" result="blur"/>
      <feFlood flood-color="${ROSE_PRIMARY}" flood-opacity="0.85"/>
      <feComposite in2="blur" operator="in" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
`;

const BACK_DEFS = `
    <linearGradient id="backBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
`;

const TEXT_STYLES = `
    <style>
      .playlist-title { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 600; font-size: 28px; letter-spacing: 1.5px; }
      .meta-date { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: bold; font-size: 96px; }
      .meta-song { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: bold; font-size: 64px; }
      .meta-artist { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 600; font-size: 48px; }
    </style>
`;

function stripEmoji(value: string): string {
	return value
		.replace(/\p{Extended_Pictographic}|\u200D|\uFE0F/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
	const text = value.split(/\s+/).filter(Boolean).join(' ');
	if (!text) {
		return [''];
	}

	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		if (word.length > maxChars) {
			if (current) {
				lines.push(current);
				current = '';
			}

			for (let index = 0; index < word.length; index += maxChars) {
				lines.push(word.slice(index, index + maxChars));
			}
			continue;
		}

		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length <= maxChars) {
			current = candidate;
		} else {
			lines.push(current);
			current = word;
		}
	}

	if (current) {
		lines.push(current);
	}

	if (lines.length <= maxLines) {
		return lines;
	}

	const truncated = lines.slice(0, maxLines);
	const lastIndex = truncated.length - 1;
	const last = truncated[lastIndex];
	truncated[lastIndex] =
		last.length >= maxChars ? `${last.slice(0, Math.max(0, maxChars - 1))}…` : `${last}…`;
	return truncated;
}

function textToTspans(params: {
	value: string;
	x: number;
	yCenter: number;
	lineHeight: number;
	maxChars: number;
	maxLines: number;
}): string {
	const lines = wrapText(params.value, params.maxChars, params.maxLines);
	const startY = params.yCenter - ((lines.length - 1) * params.lineHeight) / 2;

	const tspans = lines
		.map((line, index) => {
			if (index === 0) {
				return `<tspan x="${params.x}" y="${startY.toFixed(1)}">${escapeXml(line)}</tspan>`;
			}
			return `<tspan x="${params.x}" dy="${params.lineHeight.toFixed(1)}">${escapeXml(line)}</tspan>`;
		})
		.join('');

	return tspans;
}

async function buildQrDataUri(spotifyUrl: string, sizePx = 390): Promise<string> {
	return QRCode.toDataURL(spotifyUrl, {
		type: 'image/png',
		margin: 4,
		width: sizePx,
		color: {
			dark: '#000000',
			light: '#FFFFFF'
		}
	});
}

function frontMarkup(qrDataUri: string, playlistName: string | null, xOffset = 0): string {
	const cleanTitle = playlistName ? stripEmoji(playlistName) : '';
	const titleSvg = cleanTitle
		? `<text x="${400 + xOffset}" text-anchor="middle" fill="${ROSE_PRIMARY}" class="playlist-title">${textToTspans({
				value: cleanTitle,
				x: 400 + xOffset,
				yCenter: 110,
				lineHeight: 34,
				maxChars: 32,
				maxLines: 2
			})}</text>`
		: '';

	return `
  <rect x="${xOffset}" y="0" width="800" height="800" fill="${NOIR_BG}"/>
  ${titleSvg}
  <rect x="${165 + xOffset}" y="165" width="470" height="470" rx="26" fill="#ffffff" filter="url(#pinkGlow)"/>
  <image x="${205 + xOffset}" y="205" width="390" height="390" href="${qrDataUri}" xlink:href="${qrDataUri}" preserveAspectRatio="xMidYMid meet"/>
`;
}

function backMarkup(song: SongCardData, xOffset = 0): string {
	const artist = stripEmoji(song.artist_name);
	const songName = stripEmoji(song.song_name);
	const dateStr = normalizeReleaseDate(song.release_date);
	const cx = 400 + xOffset;

	return `
  <rect x="${xOffset}" y="0" width="800" height="800" fill="url(#backBg)"/>
  <rect x="${24 + xOffset}" y="24" width="752" height="752" rx="24" fill="#ffffff" fill-opacity="0.9"/>
  <text x="${cx}" text-anchor="middle" fill="#64748b" class="meta-artist">${textToTspans({ value: artist, x: cx, yCenter: 170, lineHeight: 56, maxChars: 28, maxLines: 99 })}</text>
  <text x="${cx}" text-anchor="middle" fill="#0f172a" class="meta-date">${textToTspans({ value: dateStr, x: cx, yCenter: 400, lineHeight: 110, maxChars: 14, maxLines: 99 })}</text>
  <text x="${cx}" text-anchor="middle" fill="#1e293b" class="meta-song">${textToTspans({ value: songName, x: cx, yCenter: 650, lineHeight: 72, maxChars: 22, maxLines: 99 })}</text>
`;
}

export type RenderOptions = { playlistName?: string | null };

export async function renderFoldSvg(
	song: SongCardData,
	options: RenderOptions = {}
): Promise<string> {
	const qrDataUri = await buildQrDataUri(song.spotify_url);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="800" viewBox="0 0 1600 800" role="img" aria-label="Song Card Fold Template">
  <defs>${FRONT_DEFS}${BACK_DEFS}${TEXT_STYLES}</defs>
  ${frontMarkup(qrDataUri, options.playlistName ?? null, 0)}
  ${backMarkup(song, 800)}
  <line x1="800" y1="0" x2="800" y2="800" stroke="#64748b" stroke-width="2" stroke-dasharray="8 8" stroke-opacity="0.45"/>
</svg>
`;
}

export async function renderFrontSvg(
	song: SongCardData,
	options: RenderOptions = {}
): Promise<string> {
	const qrDataUri = await buildQrDataUri(song.spotify_url);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="800" viewBox="0 0 800 800" role="img" aria-label="Song Card Front">
  <defs>${FRONT_DEFS}${TEXT_STYLES}</defs>
  ${frontMarkup(qrDataUri, options.playlistName ?? null, 0)}
</svg>
`;
}

export async function renderBackSvg(song: SongCardData): Promise<string> {
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800" role="img" aria-label="Song Card Back">
  <defs>${BACK_DEFS}${TEXT_STYLES}</defs>
  ${backMarkup(song, 0)}
</svg>
`;
}

function svgToPng(svg: string, widthPx: number): Uint8Array {
	const renderer = new Resvg(svg, {
		fitTo: {
			mode: 'width',
			value: widthPx
		}
	});
	return renderer.render().asPng();
}

export type DuplexCardImages = {
	front: SongCardImageBytes;
	back: SongCardImageBytes;
};

export type BatchOptions = RenderOptions & {
	imageWidthPx?: number;
};

export async function createSongCardsBatch(
	songs: SongCardData[],
	options: BatchOptions = {}
): Promise<SongCardImageBytes[]> {
	const width = options.imageWidthPx ?? 1600;
	const height = Math.max(1, Math.floor(width / 2));
	const generated: SongCardImageBytes[] = [];

	for (let index = 0; index < songs.length; index += 1) {
		const song = songs[index];
		const baseName = `${String(index + 1).padStart(3, '0')}_${slugifyFileName(song.artist_name)}_${slugifyFileName(song.song_name)}`;
		const svg = await renderFoldSvg(song, { playlistName: options.playlistName ?? null });
		const bytes = svgToPng(svg, width);
		generated.push({ fileName: `${baseName}.png`, bytes, width, height });
	}

	return generated;
}

export async function createSongCardsBatchDuplex(
	songs: SongCardData[],
	options: BatchOptions = {}
): Promise<DuplexCardImages[]> {
	const sideWidth = options.imageWidthPx ?? 800;
	const generated: DuplexCardImages[] = [];

	for (let index = 0; index < songs.length; index += 1) {
		const song = songs[index];
		const baseName = `${String(index + 1).padStart(3, '0')}_${slugifyFileName(song.artist_name)}_${slugifyFileName(song.song_name)}`;
		const frontSvg = await renderFrontSvg(song, { playlistName: options.playlistName ?? null });
		const backSvg = await renderBackSvg(song);
		const frontBytes = svgToPng(frontSvg, sideWidth);
		const backBytes = svgToPng(backSvg, sideWidth);
		generated.push({
			front: {
				fileName: `${baseName}_front.png`,
				bytes: frontBytes,
				width: sideWidth,
				height: sideWidth
			},
			back: {
				fileName: `${baseName}_back.png`,
				bytes: backBytes,
				width: sideWidth,
				height: sideWidth
			}
		});
	}

	return generated;
}
