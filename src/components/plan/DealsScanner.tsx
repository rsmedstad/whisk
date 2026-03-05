import { useState, useRef } from "react";
import { classNames } from "../../lib/utils";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Tag, Camera, Link, ChevronDown } from "../ui/Icon";

interface Deal {
  item: string;
  price: string;
  originalPrice?: string | null;
  unit?: string | null;
  category: string;
  notes?: string | null;
}

interface DealScanResult {
  deals: Deal[];
  storeName?: string | null;
  validDates?: string | null;
  message?: string;
}

interface DealsScannerProps {
  visionEnabled: boolean;
  chatEnabled: boolean;
}

export function DealsScanner({ visionEnabled, chatEnabled }: DealsScannerProps) {
  const [showDeals, setShowDeals] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [dealUrl, setDealUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  const [dealsMeta, setDealsMeta] = useState<{ storeName?: string | null; validDates?: string | null } | null>(null);
  const [dealsMessage, setDealsMessage] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);

  const handleFlyerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFlyerPreview(URL.createObjectURL(file));
    setDealUrl("");
  };

  const handleScanDeals = async () => {
    const hasPhoto = fileInputRef.current?.files?.[0];
    const hasUrl = dealUrl.trim();
    if (!hasPhoto && !hasUrl) return;

    setIsScanning(true);
    try {
      const formData = new FormData();
      if (hasPhoto) {
        formData.append("photo", fileInputRef.current!.files![0]!);
      } else {
        formData.append("url", hasUrl);
      }

      const token = localStorage.getItem("whisk_token");
      const res = await fetch("/api/discover/scan-deals", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) throw new Error("Scan failed");
      const data = (await res.json()) as DealScanResult;

      setAllDeals((prev) => [...prev, ...data.deals]);
      if (data.storeName || data.validDates) {
        setDealsMeta((prev) => prev ?? { storeName: data.storeName, validDates: data.validDates });
      }
      if (data.deals.length === 0 && data.message) {
        setDealsMessage(data.message);
      } else {
        setDealsMessage(null);
      }
      setPageCount((n) => n + 1);

      setFlyerPreview(null);
      setDealUrl("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setDealsMessage("Failed to scan. Try a clearer image or different URL.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleResetDeals = () => {
    setAllDeals([]);
    setDealsMeta(null);
    setDealsMessage(null);
    setPageCount(0);
    setFlyerPreview(null);
    setDealUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasInput = flyerPreview || dealUrl.trim();

  return (
    <section className="px-4 py-3">
      <button
        onClick={() => setShowDeals(!showDeals)}
        className="flex items-center gap-2 w-full"
      >
        <Tag className="w-4 h-4 text-stone-400 dark:text-stone-500" />
        <h2 className="text-sm font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide">
          Scan Store Deals
        </h2>
        <ChevronDown
          className={classNames(
            "w-4 h-4 text-stone-400 ml-auto transition-transform",
            showDeals && "rotate-180"
          )}
        />
      </button>

      {showDeals && (
        <div className="mt-3">
          {!visionEnabled && !chatEnabled ? (
            <Card>
              <div className="text-center py-2">
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  Add an AI provider in Settings to scan deals
                </p>
              </div>
            </Card>
          ) : (
            <>
              {/* URL input */}
              <div className="flex gap-2 mb-2">
                <div className="relative flex-1">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <input
                    type="url"
                    value={dealUrl}
                    onChange={(e) => {
                      setDealUrl(e.target.value);
                      if (e.target.value.trim()) setFlyerPreview(null);
                    }}
                    placeholder="Paste store ad URL..."
                    className="w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
                  />
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 p-2 text-stone-500 dark:text-stone-400 hover:border-orange-400"
                  title="Upload screenshot or photo"
                >
                  <Camera className="w-5 h-5" />
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFlyerSelect}
                className="hidden"
              />

              {/* Photo preview */}
              {flyerPreview && (
                <div className="rounded-xl border border-stone-200 dark:border-stone-700 overflow-hidden mb-2">
                  <img src={flyerPreview} alt="Flyer preview" className="w-full max-h-48 object-cover" />
                </div>
              )}

              {/* Scan button */}
              {hasInput && (
                <Button
                  fullWidth
                  onClick={handleScanDeals}
                  disabled={isScanning}
                >
                  {isScanning
                    ? "Scanning deals..."
                    : pageCount > 0
                      ? `Scan Page ${pageCount + 1}`
                      : "Extract Deals"}
                </Button>
              )}

              {/* Accumulated deals results */}
              {(allDeals.length > 0 || dealsMessage) && (
                <div className="mt-3 space-y-2">
                  {dealsMeta?.storeName && (
                    <p className="text-sm font-semibold dark:text-stone-200">
                      {dealsMeta.storeName}
                      {dealsMeta.validDates && (
                        <span className="ml-2 text-xs font-normal text-stone-400">
                          {dealsMeta.validDates}
                        </span>
                      )}
                    </p>
                  )}
                  {pageCount > 1 && (
                    <p className="text-xs text-stone-400 dark:text-stone-500">
                      {allDeals.length} deals from {pageCount} pages
                    </p>
                  )}
                  {dealsMessage && allDeals.length === 0 && (
                    <p className="text-sm text-stone-500 dark:text-stone-400">{dealsMessage}</p>
                  )}
                  {allDeals.length > 0 && (
                    <div className="grid grid-cols-1 gap-1.5">
                      {allDeals.map((deal, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-stone-50 dark:bg-stone-900"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium dark:text-stone-200 truncate">
                              {deal.item}
                            </p>
                            {deal.notes && (
                              <p className="text-[10px] text-stone-400 truncate">{deal.notes}</p>
                            )}
                          </div>
                          <div className="text-right ml-2 shrink-0">
                            <p className="text-sm font-bold text-orange-600 dark:text-orange-400">
                              {deal.price}
                            </p>
                            {deal.originalPrice && (
                              <p className="text-[10px] line-through text-stone-400">{deal.originalPrice}</p>
                            )}
                            {deal.unit && (
                              <p className="text-[10px] text-stone-400">{deal.unit}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {allDeals.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={handleResetDeals}
                    >
                      Start Over
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
