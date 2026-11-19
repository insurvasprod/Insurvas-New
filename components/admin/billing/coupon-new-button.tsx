"use client";

import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";

/** "New coupon" on the title line: opens the create sheet the coupons list draws (`?new=1`), with no round trip. */
export function CouponNewButton() {
  return (
    <Button type="button" onClick={() => setParamsInPlace({ new: "1", from: null, coupon: null })}>
      New coupon
    </Button>
  );
}
