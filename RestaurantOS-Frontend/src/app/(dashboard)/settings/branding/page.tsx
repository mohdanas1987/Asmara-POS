'use client';

/**
 * Branding & customer display settings (POS beautification pass): lets a manager upload
 * their own restaurant logo (shown in the sidebar/top-bar header instead of the default
 * Asmara mark) and build the media playlist shown on the customer-facing display screen --
 * photos/videos that autoplay in a loop when idle, and sit alongside the bill while a sale
 * is in progress. Backed by routes/config.js's /branding and /customer-display/media routes.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CustomerDisplayMediaItem,
  deleteCustomerDisplayMedia,
  getBranding,
  getCustomerDisplayMedia,
  uploadBrandingLogo,
  uploadCustomerDisplayMedia,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';

export default function BrandingSettingsPage() {
  const [logo, setLogo] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [media, setMedia] = useState<CustomerDisplayMediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  function load() {
    getBranding().then((r) => setLogo(r.logo)).catch(() => {});
    setMediaLoading(true);
    getCustomerDisplayMedia()
      .then((r) => setMedia(r.media || []))
      .catch(() => setMediaError('Could not load customer-display media.'))
      .finally(() => setMediaLoading(false));
  }

  useEffect(load, []);

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    setLogoError(null);
    try {
      const res = await uploadBrandingLogo(file);
      if (res.status) setLogo(res.logo);
      else setLogoError(res.message || 'Upload failed.');
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  async function handleMediaChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      for (const file of files) {
        const res = await uploadCustomerDisplayMedia(file);
        if (res.status) setMedia(res.media);
        else setMediaError('Upload failed.');
      }
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setMediaBusy(false);
      if (mediaInputRef.current) mediaInputRef.current.value = '';
    }
  }

  async function handleDeleteMedia(id: string) {
    setMediaBusy(true);
    try {
      const res = await deleteCustomerDisplayMedia(id);
      if (res.status) setMedia(res.media);
    } finally {
      setMediaBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold text-ink">Branding &amp; display</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Your restaurant&apos;s logo and the slideshow shown on the customer-facing screen.
      </p>

      {/* Logo card */}
      <section className="card-lift mb-6 animate-fadeInUp rounded-2xl border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-1 text-lg font-semibold text-ink">Restaurant logo</h2>
        <p className="mb-4 text-sm text-ink-muted">
          Shown in the sidebar header and top bar across the whole POS.
        </p>
        <div className="flex items-center gap-5">
          <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand-gradient shadow-glow">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/images/${logo}`} alt="Restaurant logo" className="h-full w-full object-contain" />
            ) : (
              <span className="text-3xl">🍽️</span>
            )}
          </div>
          <div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoChange}
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={logoBusy}
              className="shadow-glow"
              onClick={() => logoInputRef.current?.click()}
            >
              {logoBusy ? 'Uploading…' : logo ? 'Replace logo' : 'Upload logo'}
            </Button>
            <p className="mt-2 text-xs text-ink-muted">PNG or JPG, square works best.</p>
            {logoError && <p className="mt-2 text-sm text-red-600">{logoError}</p>}
          </div>
        </div>
      </section>

      {/* Customer display media card */}
      <section
        className="card-lift animate-fadeInUp rounded-2xl border border-border bg-surface p-6 shadow-card"
        style={{ animationDelay: '80ms', animationFillMode: 'backwards' }}
      >
        <h2 className="mb-1 text-lg font-semibold text-ink">Customer display slideshow</h2>
        <p className="mb-4 text-sm text-ink-muted">
          Photos and videos shown on the customer-facing screen. They loop full-screen when
          idle, and sit beside the bill while a sale is in progress. Add more than one to
          autoplay through them; each auto-fits the screen.
        </p>

        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleMediaChange}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={mediaBusy}
          onClick={() => mediaInputRef.current?.click()}
        >
          {mediaBusy ? 'Uploading…' : '+ Add photos or videos'}
        </Button>
        {mediaError && <p className="mt-2 text-sm text-red-600">{mediaError}</p>}

        {mediaLoading ? (
          <p className="mt-4 text-sm text-ink-muted">Loading…</p>
        ) : media.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center text-ink-muted">
            <span className="text-3xl">🖼️</span>
            <p className="text-sm">No media yet — the customer display shows a welcome screen.</p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {media.map((m) => (
              <div
                key={m.id}
                className="card-lift group relative overflow-hidden rounded-xl border border-border bg-surface-sunken shadow-card"
              >
                <div className="aspect-video w-full overflow-hidden bg-black">
                  {m.type === 'video' ? (
                    <video src={`/images/${m.file}`} className="h-full w-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/images/${m.file}`} alt={m.name} className="h-full w-full object-cover" />
                  )}
                </div>
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  {m.type === 'video' ? '▶ Video' : 'Photo'}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteMedia(m.id)}
                  className="touch-target absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                  aria-label="Remove"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
