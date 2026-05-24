import { Resvg } from '@resvg/resvg-js';
import QRCode from 'qrcode';

import {
	normalizeReleaseDate,
	slugifyFileName,
	type SongCardData,
	type SongCardImageBytes
} from '$lib/types/song-card';

const TEMPLATE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="800" viewBox="0 0 1600 800" role="img" aria-labelledby="title desc">
  <title id="title">Song Card Fold Template</title>
  <desc id="desc">2:1 foldable card template. Left side is front with QR. Right side is back with song metadata.</desc>

  <defs>
    <linearGradient id="frontBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2a0246"/>
      <stop offset="100%" stop-color="#502300"/>
    </linearGradient>

    <linearGradient id="backBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>

    <style>
      .meta-date { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: bold; font-size: 96px; }
      .meta-song { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: bold; font-size: 64px; }
      .meta-artist { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 600; font-size: 48px; }
    </style>
  </defs>

  <rect x="0" y="0" width="800" height="800" fill="url(#frontBg)"/>
  <rect x="165" y="165" width="470" height="470" rx="26" fill="#ffffff"/>
  <image id="qr-code" x="205" y="205" width="390" height="390" href="__QR_DATA_URI__" xlink:href="__QR_DATA_URI__" preserveAspectRatio="xMidYMid meet"/>

  <rect x="800" y="0" width="800" height="800" fill="url(#backBg)"/>
  <rect x="824" y="24" width="752" height="752" rx="24" fill="#ffffff" fill-opacity="0.9"/>

  <text id="artist-text" x="1200" y="170" text-anchor="middle" fill="#64748b" class="meta-artist">__ARTIST_NAME__</text>
  <text id="date-text" x="1200" y="400" text-anchor="middle" fill="#0f172a" class="meta-date">__RELEASE_DATE__</text>
  <text id="song-text" x="1200" y="650" text-anchor="middle" fill="#1e293b" class="meta-song">__SONG_NAME__</text>

  <line x1="800" y1="0" x2="800" y2="800" stroke="#64748b" stroke-width="2" stroke-dasharray="8 8" stroke-opacity="0.45"/>
</svg>
`;

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

	return lines;
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

export async function renderSongCardSvg(song: SongCardData): Promise<string> {
	const qrDataUri = await buildQrDataUri(song.spotify_url);

	return TEMPLATE_SVG.replaceAll('__QR_DATA_URI__', qrDataUri)
		.replace(
			'<text id="artist-text" x="1200" y="170" text-anchor="middle" fill="#64748b" class="meta-artist">__ARTIST_NAME__</text>',
			`<text id="artist-text" x="1200" text-anchor="middle" fill="#64748b" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="600" font-size="48px">${textToTspans({ value: song.artist_name, x: 1200, yCenter: 170, lineHeight: 56, maxChars: 28, maxLines: 99 })}</text>`
		)
		.replace(
			'<text id="date-text" x="1200" y="400" text-anchor="middle" fill="#0f172a" class="meta-date">__RELEASE_DATE__</text>',
			`<text id="date-text" x="1200" text-anchor="middle" fill="#0f172a" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="bold" font-size="96px">${textToTspans({ value: normalizeReleaseDate(song.release_date), x: 1200, yCenter: 400, lineHeight: 110, maxChars: 14, maxLines: 99 })}</text>`
		)
		.replace(
			'<text id="song-text" x="1200" y="650" text-anchor="middle" fill="#1e293b" class="meta-song">__SONG_NAME__</text>',
			`<text id="song-text" x="1200" text-anchor="middle" fill="#1e293b" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="bold" font-size="64px">${textToTspans({ value: song.song_name, x: 1200, yCenter: 650, lineHeight: 72, maxChars: 22, maxLines: 99 })}</text>`
		);
}

export async function createSongCardImage(
	song: SongCardData,
	fileName: string,
	imageWidthPx = 1600
): Promise<SongCardImageBytes> {
	const imageHeightPx = Math.max(1, Math.floor(imageWidthPx / 2));
	const svg = await renderSongCardSvg(song);

	const renderer = new Resvg(svg, {
		fitTo: {
			mode: 'width',
			value: imageWidthPx
		}
	});
	const pngBytes = renderer.render().asPng();

	return {
		fileName,
		bytes: pngBytes,
		width: imageWidthPx,
		height: imageHeightPx
	};
}

export async function createSongCardsBatch(songs: SongCardData[]): Promise<SongCardImageBytes[]> {
	const generated: SongCardImageBytes[] = [];

	for (let index = 0; index < songs.length; index += 1) {
		const song = songs[index];
		const fileName = `${String(index + 1).padStart(3, '0')}_${slugifyFileName(song.artist_name)}_${slugifyFileName(song.song_name)}.png`;
		const card = await createSongCardImage(song, fileName);
		generated.push(card);
	}

	return generated;
}
