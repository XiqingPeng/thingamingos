import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelizeRgbaBuffer } from '../web/pixelize.js';
import { seed, mutate, publicState } from '../lib/domain.js';

test('pixelizeRgbaBuffer extracts central rose-pink object from tan desk background with dark outline', () => {
  const workN = 96;
  const rgba = new Uint8ClampedArray(workN * workN * 4);
  for (let y = 0; y < workN; y++) {
    for (let x = 0; x < workN; x++) {
      const idx = (y * workN + x) * 4;
      const dx = x - 48, dy = y - 48;
      if (dx * dx + dy * dy <= 24 * 24) {
        // Rose-pink / cool blush mouse body with a dark vertical button split
        if (Math.abs(dx - 2) <= 1 && Math.abs(dy) < 16) {
          rgba[idx] = 68; rgba[idx + 1] = 48; rgba[idx + 2] = 52; rgba[idx + 3] = 255;
        } else if (dx < 2) {
          rgba[idx] = 178; rgba[idx + 1] = 132; rgba[idx + 2] = 130; rgba[idx + 3] = 255;
        } else {
          rgba[idx] = 196; rgba[idx + 1] = 182; rgba[idx + 2] = 186; rgba[idx + 3] = 255;
        }
      } else {
        // Warm yellow-tan desk wood background
        rgba[idx] = 198; rgba[idx + 1] = 184; rgba[idx + 2] = 148; rgba[idx + 3] = 255;
      }
    }
  }

  const sprite = pixelizeRgbaBuffer(rgba, workN, { grid: 48, mode: 'sprite' });
  assert.equal(sprite.length, 48 * 48 * 4);
  // Corner pixels should be transparent (alpha === 0)
  assert.equal(sprite[3], 0);
  assert.equal(sprite[(47 * 48 + 47) * 4 + 3], 0);
  // Center pixel should be opaque (alpha === 255)
  assert.equal(sprite[(24 * 48 + 24) * 4 + 3], 255);

  // Card mode keeps full frame opaque with border
  const card = pixelizeRgbaBuffer(rgba, workN, { grid: 48, mode: 'card' });
  assert.equal(card[3], 255);
  assert.equal(card[(24 * 48 + 24) * 4 + 3], 255);
});

test('domain stores and exposes pixel_media_url while validating ownership and image mime', () => {
  const s = seed();
  s.media.push(
    { id: '11'.repeat(16), mime: 'image/jpeg', filename: 'mouse.jpg', size: 1000, author_id: 'a', upload_id: 'aa'.repeat(16), sha256: '00'.repeat(32) },
    { id: '22'.repeat(16), mime: 'image/png', filename: 'mouse-pixel.png', size: 800, author_id: 'a', upload_id: 'bb'.repeat(16), sha256: 'ff'.repeat(32) },
    { id: '33'.repeat(16), mime: 'video/mp4', filename: 'clip.mp4', size: 1200, author_id: 'a', upload_id: 'cc'.repeat(16), sha256: 'ee'.repeat(32) },
  );
  assert.throws(() => mutate(s, 'objects', { name: '垂直鼠标', object_type: '鼠标', media_id: '11'.repeat(16), pixel_media_id: '33'.repeat(16) }, 'a'), /像素形象文件无效/);
  assert.throws(() => mutate(s, 'objects', { name: '垂直鼠标', object_type: '鼠标', media_id: '11'.repeat(16), pixel_media_id: '22'.repeat(16) }, 'b'), /重新上传/);

  const created = mutate(s, 'objects', { name: '粉粉鼠标', object_type: '人体工学鼠标', media_id: '11'.repeat(16), pixel_media_id: '22'.repeat(16) }, 'a');
  const pub = publicState(s, 'a', 'ab'.repeat(16));
  const item = pub.objects.find(o => o.id === created.id);
  assert.equal(item.media_url, `/media/${'11'.repeat(16)}?room=${'ab'.repeat(16)}`);
  assert.equal(item.pixel_media_url, `/media/${'22'.repeat(16)}?room=${'ab'.repeat(16)}`);
});
