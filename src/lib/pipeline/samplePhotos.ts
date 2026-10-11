// Real sample photos — the Studio's "load a sample" path.
//
// The Studio used to demo only a procedurally drawn scene. A drawn scene proves
// the maths but not the claim: the app's whole premise is "a messy phone photo
// of a product", and only a real photograph exercises the parts of the pipeline
// that actually matter (sensor noise, a busy background, the AI matte's real
// failure modes).
//
// WHY THESE HOSTS: a photo drawn into a canvas TAINTS it unless the response
// carries `Access-Control-Allow-Origin`, and a tainted canvas makes
// `getImageData` throw — which would break the entire pipeline at stage 1.
// Every URL below was verified by hand to return:
//
//   HTTP/2 200 · content-type: image/jpeg · access-control-allow-origin: *
//
// (checked with a GET that includes an `Origin:` header — some CDNs only emit
// CORS headers on GET, not HEAD). Do not add a URL here without re-checking
// those three things.
//
// The procedural scene in demo.ts is kept as the offline fallback: if the CDN is
// unreachable the app still has a deterministic sample instead of an error.

import { getDemoBefore } from "./demo";

export interface SamplePhoto {
  id: string;
  label: string;
  /** What the main subject is — shown to the user, and useful when debugging. */
  subject: string;
  /** Direct image URL on a CORS-permissive CDN (see the note above). */
  url: string;
  photographer: string;
  /** Attribution page for the photo. */
  source: string;
}

export const SAMPLE_PHOTOS: SamplePhoto[] = [
  {
    id: "desk-clutter",
    label: "Messy desk",
    subject: "laptop",
    url: "https://images.pexels.com/photos/4997819/pexels-photo-4997819.jpeg?auto=compress&cs=tinysrgb&w=1260",
    photographer: "Rachel Claire",
    source: "https://www.pexels.com/photo/4997819/",
  },
  {
    id: "sneakers-floor",
    label: "Sneakers",
    subject: "sneakers",
    url: "https://images.pexels.com/photos/6776561/pexels-photo-6776561.jpeg?auto=compress&cs=tinysrgb&w=1260",
    photographer: "Hipkicks",
    source: "https://www.pexels.com/photo/6776561/",
  },
  {
    id: "headphones-table",
    label: "Headphones",
    subject: "headphones",
    url: "https://images.pexels.com/photos/8414344/pexels-photo-8414344.jpeg?auto=compress&cs=tinysrgb&w=1260",
    photographer: "Zafer Erdoğan",
    source: "https://www.pexels.com/photo/8414344/",
  },
  {
    id: "headphones-desk",
    label: "Headphones on desk",
    subject: "headphones",
    url: "https://images.pexels.com/photos/610945/pexels-photo-610945.jpeg?auto=compress&cs=tinysrgb&w=1260",
    photographer: "Garrett Morrow",
    source: "https://www.pexels.com/photo/610945/",
  },
];

/** The photo the "load sample" button tries first. */
export const DEFAULT_SAMPLE = SAMPLE_PHOTOS[0];

/** What a loaded sample turned out to be. */
export interface LoadedSample {
  bitmap: ImageBitmap;
  /** Display name for the file-name badge. */
  name: string;
  /** Attribution, or null when the procedural fallback was used. */
  photo: SamplePhoto | null;
  /** True when this is the built-in procedural scene (known exact bbox). */
  procedural: boolean;
}

/**
 * Decode a URL into an ImageBitmap *without* tainting the canvas.
 *
 * `crossOrigin` MUST be set before `src` is assigned — setting it afterwards
 * silently has no effect and the image taints the canvas on first draw. The
 * timeout exists because a hanging CDN request would otherwise leave the Studio
 * stuck in its "processing" state forever.
 */
async function loadRemoteBitmap(
  url: string,
  timeoutMs: number,
): Promise<ImageBitmap> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      img.src = "";
      reject(new Error(`sample photo timed out: ${url}`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    img.onload = done;
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`sample photo failed to load: ${url}`));
    };
    img.src = url;
  });

  return await createImageBitmap(img);
}

/** Decode the procedural scene through the exact same path as a real photo. */
async function loadProceduralBitmap(): Promise<ImageBitmap> {
  const dataUrl = getDemoBefore();
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("procedural sample failed"));
    img.src = dataUrl;
  });
  return await createImageBitmap(img);
}

/**
 * Load a sample for the Studio: real photographs first, procedural scene last.
 *
 * Resolves with something usable in every case — this is on the critical path
 * of a button the user just pressed, so "no sample available" is not an
 * acceptable outcome. `preferredId` lets the UI pin one photo; when it is
 * omitted the rest of the list is used as a fallback chain, so one dead CDN
 * object doesn't cost the user the feature.
 */
export async function loadSample(
  preferredId?: string,
  timeoutMs = 12_000,
): Promise<LoadedSample> {
  const ordered = preferredId
    ? [
        ...SAMPLE_PHOTOS.filter((p) => p.id === preferredId),
        ...SAMPLE_PHOTOS.filter((p) => p.id !== preferredId),
      ]
    : SAMPLE_PHOTOS;

  for (const photo of ordered) {
    try {
      const bitmap = await loadRemoteBitmap(photo.url, timeoutMs);
      return {
        bitmap,
        name: `${photo.id}.jpg`,
        photo,
        procedural: false,
      };
    } catch (err) {
      console.warn("[samplePhotos] falling back:", err);
    }
  }

  // Offline (or every CDN object is gone): use the deterministic scene.
  const bitmap = await loadProceduralBitmap();
  return {
    bitmap,
    name: "sample-laptop-on-deck.jpg",
    photo: null,
    procedural: true,
  };
}
