import type { Metadata } from "next";

import { PartnerLoginForm } from "@/components/partner/partner-login-form";

export const metadata: Metadata = { title: "Partner portal sign in · Insurvas" };

export default function PartnerLoginPage() { return <PartnerLoginForm />; }
