const VIDEO_URL = "/mascot/mascot-animation-light.webm";
const BODY_HEX = "#EAD9FF";

export function MascotMotionPreview() {
  return (
    <main className="min-h-[calc(100vh-1px)] overflow-hidden bg-[#f7f9fd] px-5 py-6 text-slate-950 sm:px-8 lg:px-10">
      <section className="mx-auto grid min-h-[calc(100vh-48px)] max-w-6xl grid-cols-1 items-stretch gap-6 lg:grid-cols-[1fr_360px]">
        <div className="relative overflow-hidden rounded-[28px] border border-[#E1D8F3] bg-white shadow-[0_24px_80px_rgba(50,43,72,0.12)]">
          <div className="absolute inset-0 soft-grid opacity-35" />
          <div className="absolute inset-x-8 top-8 z-10 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8D70C7]">
                CMO Engine
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">
                Mascot Motion Preview
              </h1>
            </div>
            <span
              className="rounded-full border border-[#EAD9FF] bg-[#F4ECFF] px-3 py-1 text-xs font-semibold text-[#5C4396]"
              data-status="ready"
            >
              Ready
            </span>
          </div>

          <div className="relative flex h-[560px] w-full items-center justify-center pt-20 sm:h-[640px]">
            <video
              aria-label="Holdstation mascot animation preview"
              autoPlay
              className="relative z-[1] h-auto max-h-[430px] w-auto max-w-[min(78%,620px)] object-contain mix-blend-multiply sm:max-h-[500px]"
              loop
              muted
              playsInline
              preload="auto"
            >
              <source src={VIDEO_URL} type="video/webm" />
            </video>
          </div>
        </div>

        <aside className="flex flex-col justify-center gap-3">
          <div className="rounded-2xl border border-[#C0A0F0]/25 bg-white p-5 shadow-[0_18px_45px_rgba(36,22,79,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Asset Check
            </p>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="font-semibold text-slate-950">Format</dt>
                <dd className="mt-1 text-slate-600">
                  WebM VP9, cleaned white background, 620x572, 24fps, no audio
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Motion</dt>
                <dd className="mt-1 text-slate-600">
                  Source video loop on a white background. No alpha keying or
                  Three.js skeleton runtime, so the motion stays faithful to the
                  supplied animation.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Palette</dt>
                <dd className="mt-1 flex items-center gap-2 text-slate-600">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: BODY_HEX }}
                  />
                  Reference lavender / {BODY_HEX}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Weight</dt>
                <dd className="mt-1 text-slate-600">
                  589 KB WebM converted from the supplied light-background MP4.
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </section>
    </main>
  );
}
