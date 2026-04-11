import QRCode from 'qrcode';

import {
	normalizeReleaseDate,
	slugifyFileName,
	type SongCardData,
	type SongCardImage
} from '$lib/types/song-card';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

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
      .kicker { font: 700 28px "Helvetica Neue", Helvetica, Arial, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; }
      .meta-date { font: 700 64px "Helvetica Neue", Helvetica, Arial, sans-serif; }
      .meta-song { font: 600 52px "Helvetica Neue", Helvetica, Arial, sans-serif; }
      .meta-artist { font: 500 42px "Helvetica Neue", Helvetica, Arial, sans-serif; }
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

type ProgressHandler = (progress: { current: number; total: number }) => void;

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

	const clipped = lines.slice(0, maxLines);
	const last = clipped[clipped.length - 1] ?? '';
	clipped[clipped.length - 1] =
		last.length >= maxChars ? `${last.slice(0, Math.max(0, last.length - 1))}...` : `${last}...`;

	return clipped;
}

function setTextLines(params: {
	doc: XMLDocument;
	textId: string;
	value: string;
	x: number;
	yCenter: number;
	lineHeight: number;
	maxChars: number;
	maxLines: number;
}): void {
	const textNode = params.doc.querySelector(`text#${params.textId}`);
	if (!textNode) {
		throw new Error(`Template is missing text node id='${params.textId}'`);
	}

	const lines = wrapText(params.value, params.maxChars, params.maxLines);
	const startY = params.yCenter - ((lines.length - 1) * params.lineHeight) / 2;

	textNode.setAttribute('x', String(params.x));
	textNode.setAttribute('y', startY.toFixed(1));
	textNode.textContent = '';

	for (const [index, line] of lines.entries()) {
		const tspan = params.doc.createElementNS(SVG_NS, 'tspan');
		tspan.setAttribute('x', String(params.x));
		if (index > 0) {
			tspan.setAttribute('dy', params.lineHeight.toFixed(1));
		}
		tspan.textContent = line;
		textNode.appendChild(tspan);
	}
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

function xmlToString(document: XMLDocument): string {
	return new XMLSerializer().serializeToString(document);
}

async function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
	const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(svgBlob);

	try {
		const image = await loadImage(url);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('Canvas 2D context is not available');
		}

		context.drawImage(image, 0, 0, width, height);
		const blob = await canvasToBlob(canvas);
		if (!blob) {
			throw new Error('Could not encode card PNG');
		}

		return blob;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Failed loading SVG image data'));
		image.src = url;
	});
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), 'image/png');
	});
}

export async function renderSongCardSvg(song: SongCardData): Promise<string> {
	const parser = new DOMParser();
	const document = parser.parseFromString(TEMPLATE_SVG, 'image/svg+xml');
	const parseError = document.querySelector('parsererror');
	if (parseError) {
		throw new Error('Card template SVG could not be parsed');
	}

	const qrNode = document.querySelector('image#qr-code');
	if (!qrNode) {
		throw new Error("Template is missing image node id='qr-code'");
	}

	const qrDataUri = await buildQrDataUri(song.spotify_url);
	qrNode.setAttribute('href', qrDataUri);
	qrNode.setAttributeNS(XLINK_NS, 'xlink:href', qrDataUri);

	setTextLines({
		doc: document,
		textId: 'artist-text',
		value: song.artist_name,
		x: 1200,
		yCenter: 170,
		lineHeight: 48,
		maxChars: 24,
		maxLines: 2
	});

	setTextLines({
		doc: document,
		textId: 'date-text',
		value: normalizeReleaseDate(song.release_date),
		x: 1200,
		yCenter: 400,
		lineHeight: 70,
		maxChars: 16,
		maxLines: 2
	});

	setTextLines({
		doc: document,
		textId: 'song-text',
		value: song.song_name,
		x: 1200,
		yCenter: 650,
		lineHeight: 56,
		maxChars: 22,
		maxLines: 3
	});

	return xmlToString(document);
}

export async function createSongCardImage(
	song: SongCardData,
	fileName: string,
	imageWidthPx = 1600
): Promise<SongCardImage> {
	const imageHeightPx = Math.max(1, Math.floor(imageWidthPx / 2));
	const svg = await renderSongCardSvg(song);
	const blob = await svgToPngBlob(svg, imageWidthPx, imageHeightPx);

	return {
		fileName,
		blob
	};
}

export async function createSongCardsBatch(
	songs: SongCardData[],
	onProgress?: ProgressHandler
): Promise<SongCardImage[]> {
	const generated: SongCardImage[] = [];
	const total = songs.length;

	for (let index = 0; index < songs.length; index += 1) {
		const song = songs[index];
		const fileName = `${String(index + 1).padStart(3, '0')}_${slugifyFileName(song.artist_name)}_${slugifyFileName(song.song_name)}.png`;
		const card = await createSongCardImage(song, fileName);
		generated.push(card);
		onProgress?.({ current: index + 1, total });
	}

	return generated;
}
