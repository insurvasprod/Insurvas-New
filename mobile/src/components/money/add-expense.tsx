import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";

import { snapReceipt, type Photo } from "./device";
import { MoneyTab } from "./money-tab";

/**
 * Boards G5 → G6 · Expenses › Add: the camera first (G5), then the new expense as a sheet over Money (G6). The camera
 * is the phone's own (expo-image-picker): the board's full-screen camera with the edge found, the tip and Auto needs
 * a camera module this app does not ship yet (a new development build), and nothing on the server reads a receipt.
 * Backing out of the camera backs out of Add. Once saved, the sheet closes onto Money, which says so (and reads the month
 * again), so the saved message is seen; Back from there leaves as it came.
 */
export function AddExpense({ initialPhoto = null }: { initialPhoto?: Photo | null }) {
  const [photo, setPhoto] = useState<Photo | null>(initialPhoto);
  const [open, setOpen] = useState(Boolean(initialPhoto));
  const asked = useRef(false);
  useEffect(() => {
    if (initialPhoto || asked.current) return;
    asked.current = true;
    void snapReceipt().then((shot) => {
      if (!shot) { router.back(); return; }
      setPhoto(shot);
      setOpen(true);
    });
  }, [initialPhoto]);
  return <MoneyTab asTab={false} expense={{ open, photo, onPhoto: setPhoto, onClose: () => router.back(), onSaved: () => setOpen(false) }} />;
}
