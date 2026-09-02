export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  public: {
    Tables: {
      advance_rules: {
        Row: {
          advance_months: number;
          advance_pct_bp: number;
          carrier_id: string;
          clawback_months: number;
          clawback_type: string;
          created_at: string;
          effective_from: string;
          id: string;
          product_code: string;
          tenant_id: string;
        };
        Insert: {
          advance_months: number;
          advance_pct_bp: number;
          carrier_id: string;
          clawback_months: number;
          clawback_type: string;
          created_at?: string;
          effective_from: string;
          id?: string;
          product_code: string;
          tenant_id: string;
        };
        Update: {
          advance_months?: number;
          advance_pct_bp?: number;
          carrier_id?: string;
          clawback_months?: number;
          clawback_type?: string;
          created_at?: string;
          effective_from?: string;
          id?: string;
          product_code?: string;
          tenant_id?: string;
        };
        Relationships: [];
      };
      appointments: {
        Row: { id: string; tenant_id: string; carrier_id: string; state: string; status: string; effective_from: string; terminated_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; carrier_id: string; state: string; status?: string; effective_from: string; terminated_at?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; carrier_id?: string; state?: string; status?: string; effective_from?: string; terminated_at?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      ce_records: {
        Row: { id: string; tenant_id: string; state: string; credits_required: number; credits_completed: number; deadline: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; state: string; credits_required: number; credits_completed: number; deadline: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; state?: string; credits_required?: number; credits_completed?: number; deadline?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      carriers: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      eo_policies: {
        Row: { id: string; tenant_id: string; carrier: string; policy_number: string; expires_at: string; coverage_amount_cents: number; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; carrier: string; policy_number: string; expires_at: string; coverage_amount_cents: number; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; carrier?: string; policy_number?: string; expires_at?: string; coverage_amount_cents?: number; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      licenses: {
        Row: { id: string; tenant_id: string; state: string; license_number: string; expires_at: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; state: string; license_number: string; expires_at: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; state?: string; license_number?: string; expires_at?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      commission_schedules: {
        Row: {
          carrier_id: string;
          contract_level_bp: number;
          created_at: string;
          effective_from: string;
          id: string;
          policy_year: number;
          product_code: string;
          rate_bp: number;
          tenant_id: string;
        };
        Insert: {
          carrier_id: string;
          contract_level_bp: number;
          created_at?: string;
          effective_from: string;
          id?: string;
          policy_year: number;
          product_code: string;
          rate_bp: number;
          tenant_id: string;
        };
        Update: {
          carrier_id?: string;
          contract_level_bp?: number;
          created_at?: string;
          effective_from?: string;
          id?: string;
          policy_year?: number;
          product_code?: string;
          rate_bp?: number;
          tenant_id?: string;
        };
        Relationships: [];
      };
      tenant_carriers: {
        Row: {
          carrier_id: string;
          contract_level_bp: number;
          created_at: string;
          effective_from: string;
          id: string;
          is_active: boolean;
          tenant_id: string;
          writing_number: string;
        };
        Insert: {
          carrier_id: string;
          contract_level_bp: number;
          created_at?: string;
          effective_from: string;
          id?: string;
          is_active?: boolean;
          tenant_id: string;
          writing_number: string;
        };
        Update: {
          carrier_id?: string;
          contract_level_bp?: number;
          created_at?: string;
          effective_from?: string;
          id?: string;
          is_active?: boolean;
          tenant_id?: string;
          writing_number?: string;
        };
        Relationships: [];
      };
      admin_users: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          is_active: boolean;
          last_login_at: string | null;
          name: string;
          password_hash: string;
          role: Database["public"]["Enums"]["admin_role"];
          totp_secret: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          is_active?: boolean;
          last_login_at?: string | null;
          name: string;
          password_hash: string;
          role: Database["public"]["Enums"]["admin_role"];
          totp_secret: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          is_active?: boolean;
          last_login_at?: string | null;
          name?: string;
          password_hash?: string;
          role?: Database["public"]["Enums"]["admin_role"];
          totp_secret?: string;
        };
        Relationships: [];
      };
      email_log: {
        Row: {
          dedupe_key: string | null;
          failure_reason: string | null;
          id: string;
          provider: string;
          provider_message_id: string | null;
          status: Database["public"]["Enums"]["email_status"];
          subject: string;
          template_key: string;
          tenant_id: string | null;
          to_address: string;
          ts: string;
          user_id: string | null;
        };
        Insert: {
          dedupe_key?: string | null;
          failure_reason?: string | null;
          id?: string;
          provider?: string;
          provider_message_id?: string | null;
          status: Database["public"]["Enums"]["email_status"];
          subject: string;
          template_key: string;
          tenant_id?: string | null;
          to_address: string;
          ts?: string;
          user_id?: string | null;
        };
        // Append-only: UPDATE and DELETE are revoked at the database, so a call that would be
        // refused at runtime fails to compile instead.
        Update: never;
        Relationships: [];
      };
      legal_documents: {
        Row: {
          change_summary: string | null;
          content: string;
          doc_type: Database["public"]["Enums"]["legal_doc_type"];
          effective_date: string;
          id: string;
          is_draft: boolean;
          published_at: string;
          published_by: string | null;
          requires_reacceptance: boolean;
          title: string;
          version: number;
        };
        Insert: {
          change_summary?: string | null;
          content: string;
          doc_type: Database["public"]["Enums"]["legal_doc_type"];
          effective_date: string;
          id?: string;
          is_draft?: boolean;
          published_at?: string;
          published_by?: string | null;
          requires_reacceptance?: boolean;
          title: string;
          version: number;
        };
        // UPDATE and DELETE are revoked at the database. Typed as never so a call that would be
        // refused at runtime fails to compile instead.
        Update: never;
        Relationships: [];
      };
      legal_acceptances: {
        Row: {
          accepted_at: string;
          context: string;
          doc_type: Database["public"]["Enums"]["legal_doc_type"];
          document_id: string;
          id: string;
          ip: string | null;
          user_agent: string | null;
          user_id: string;
          version: number;
        };
        Insert: {
          accepted_at?: string;
          context?: string;
          doc_type: Database["public"]["Enums"]["legal_doc_type"];
          document_id: string;
          id?: string;
          ip?: string | null;
          user_agent?: string | null;
          user_id: string;
          version: number;
        };
        Update: never;
        Relationships: [];
      };
      trial_reminders: {
        Row: {
          delivered: boolean;
          due_at: string;
          id: string;
          kind: Database["public"]["Enums"]["trial_reminder_kind"];
          sent_at: string;
          subscription_id: string;
          trial_ends_at: string;
        };
        Insert: {
          delivered?: boolean;
          due_at: string;
          id?: string;
          kind: Database["public"]["Enums"]["trial_reminder_kind"];
          sent_at?: string;
          subscription_id: string;
          trial_ends_at: string;
        };
        Update: { delivered?: boolean };
        Relationships: [];
      };
      checkout_sessions: {
        Row: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          checkout_url: string;
          completed_at: string | null;
          coupon_id: string | null;
          created_at: string;
          id: string;
          plan_id: string;
          provider: string;
          provider_config_id: string;
          status: string;
          tenant_id: string;
        };
        Insert: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          checkout_url: string;
          completed_at?: string | null;
          coupon_id?: string | null;
          created_at?: string;
          id?: string;
          plan_id: string;
          provider?: string;
          provider_config_id: string;
          status?: string;
          tenant_id: string;
        };
        Update: { status?: string; completed_at?: string | null };
        Relationships: [];
      };
      rate_limits: {
        Row: { bucket_key: string; window_start: string; hits: number };
        Insert: { bucket_key: string; window_start: string; hits?: number };
        Update: { hits?: number };
        Relationships: [];
      };
      compliance_vendors: {
        Row: {
          id: string;
          name: string;
          vendor_type: string;
          endpoint: string;
          credentials_enc: string | null;
          is_enabled: boolean;
          priority: number;
          cost_per_lookup_cents: number;
          last_success_at: string | null;
          failure_count_24h: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          vendor_type: string;
          endpoint: string;
          credentials_enc?: string | null;
          is_enabled?: boolean;
          priority?: number;
          cost_per_lookup_cents?: number;
          last_success_at?: string | null;
          failure_count_24h?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          vendor_type?: string;
          endpoint?: string;
          credentials_enc?: string | null;
          is_enabled?: boolean;
          priority?: number;
          cost_per_lookup_cents?: number;
          last_success_at?: string | null;
          failure_count_24h?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      screening_results: {
        Row: {
          id: string;
          tenant_id: string;
          phone_digits: string;
          outcome: string;
          vendor: string;
          raw_response: Json;
          warnings: Json;
          version: number;
          checked_at: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          phone_digits: string;
          outcome: string;
          vendor: string;
          raw_response: Json;
          warnings?: Json;
          version: number;
          checked_at?: string;
          expires_at: string;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      screening_audit: {
        Row: {
          id: string;
          tenant_id: string;
          partner_id: string | null;
          user_id: string | null;
          phone_digits: string | null;
          outcome: string;
          vendor: string | null;
          raw_response: Json;
          result_id: string | null;
          cached: boolean;
          version: number;
          ts: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          partner_id?: string | null;
          user_id?: string | null;
          phone_digits?: string | null;
          outcome: string;
          vendor?: string | null;
          raw_response: Json;
          result_id?: string | null;
          cached?: boolean;
          version: number;
          ts?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      screening_cache_locks: {
        Row: { tenant_id: string; phone_digits: string; version: number; claim_token: string | null; claimed_until: string | null; updated_at: string };
        Insert: { tenant_id: string; phone_digits: string; version: number; claim_token?: string | null; claimed_until?: string | null; updated_at?: string };
        Update: { claim_token?: string | null; claimed_until?: string | null; updated_at?: string };
        Relationships: [];
      };
      credit_packs: {
        Row: {
          id: string;
          name: string;
          meter_key: string;
          quantity: number;
          price_cents: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          meter_key: string;
          quantity: number;
          price_cents: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          meter_key?: string;
          quantity?: number;
          price_cents?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      meter_pricing: {
        Row: {
          meter_key: string;
          cost_cents: number;
          sell_cents: number;
          default_included: number | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          meter_key: string;
          cost_cents?: number;
          sell_cents?: number;
          default_included?: number | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          meter_key?: string;
          cost_cents?: number;
          sell_cents?: number;
          default_included?: number | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      credit_grants: {
        Row: {
          id: string;
          tenant_id: string;
          meter_key: string;
          quantity: number;
          reason: string;
          granted_by: string | null;
          granted_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          meter_key: string;
          quantity: number;
          reason: string;
          granted_by?: string | null;
          granted_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      maintenance: {
        Row: {
          id: number;
          level: string;
          message: string;
          scheduled_start: string | null;
          scheduled_end: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          level: string;
          message: string;
          scheduled_start?: string | null;
          scheduled_end?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          level?: string;
          message?: string;
          scheduled_start?: string | null;
          scheduled_end?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      announcements: {
        Row: {
          id: string;
          message: string;
          type: string;
          audience: string;
          starts_at: string;
          ends_at: string;
          is_dismissible: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          message: string;
          type: string;
          audience?: string;
          starts_at: string;
          ends_at: string;
          is_dismissible?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          message?: string;
          type?: string;
          audience?: string;
          starts_at?: string;
          ends_at?: string;
          is_dismissible?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      announcement_dismissals: {
        Row: { announcement_id: string; user_id: string; dismissed_at: string };
        Insert: { announcement_id: string; user_id: string; dismissed_at?: string };
        Update: { dismissed_at?: string };
        Relationships: [];
      };
      metrics_daily: {
        Row: {
          active_customers: number;
          arr_cents: number;
          churned_customers: number;
          churned_mrr_cents: number;
          collected_cents: number;
          computed_at: string;
          contraction_mrr_cents: number;
          date: string;
          expansion_mrr_cents: number;
          mrr_cents: number;
          new_customers: number;
          new_mrr_cents: number;
          plan_breakdown: Json;
          trials_active: number;
        };
        Insert: {
          active_customers?: number;
          arr_cents?: number;
          churned_customers?: number;
          churned_mrr_cents?: number;
          collected_cents?: number;
          computed_at?: string;
          contraction_mrr_cents?: number;
          date: string;
          expansion_mrr_cents?: number;
          mrr_cents?: number;
          new_customers?: number;
          new_mrr_cents?: number;
          plan_breakdown?: Json;
          trials_active?: number;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      credit_notes: {
        Row: {
          amount_cents: number;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          failure_reason: string | null;
          id: string;
          invoice_id: string | null;
          number: string;
          provider_refund_id: string | null;
          reason_code: Database["public"]["Enums"]["credit_reason"];
          reason_text: string | null;
          rejected_reason: string | null;
          requested_by: string | null;
          status: Database["public"]["Enums"]["credit_note_status"];
          tenant_id: string;
          type: Database["public"]["Enums"]["credit_note_type"];
        };
        Insert: {
          amount_cents: number;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          invoice_id?: string | null;
          number: string;
          provider_refund_id?: string | null;
          reason_code: Database["public"]["Enums"]["credit_reason"];
          reason_text?: string | null;
          rejected_reason?: string | null;
          requested_by?: string | null;
          status?: Database["public"]["Enums"]["credit_note_status"];
          tenant_id: string;
          type: Database["public"]["Enums"]["credit_note_type"];
        };
        // Only progress through approval and the provider is updatable; the amount, type, reason
        // and number are fixed once raised.
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          failure_reason?: string | null;
          provider_refund_id?: string | null;
          rejected_reason?: string | null;
          status?: Database["public"]["Enums"]["credit_note_status"];
        };
        Relationships: [];
      };
      tenant_credits: {
        Row: { balance_cents: number; tenant_id: string; updated_at: string };
        Insert: { balance_cents?: number; tenant_id: string; updated_at?: string };
        Update: { balance_cents?: number; updated_at?: string };
        Relationships: [];
      };
      coupons: {
        Row: {
          amount_off_cents: number | null;
          billing_cycle: Database["public"]["Enums"]["billing_cycle"] | null;
          code: string;
          created_at: string;
          created_by: string | null;
          discount_type: Database["public"]["Enums"]["discount_type"];
          duration: Database["public"]["Enums"]["coupon_duration"];
          duration_periods: number | null;
          expires_at: string | null;
          id: string;
          is_active: boolean;
          max_redemptions: number | null;
          percent_off: number | null;
          redeemed_count: number;
          restricted_to_plan_ids: string[] | null;
          whop_promo_code_id: string | null;
        };
        Insert: {
          amount_off_cents?: number | null;
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"] | null;
          code: string;
          created_at?: string;
          created_by?: string | null;
          discount_type: Database["public"]["Enums"]["discount_type"];
          duration: Database["public"]["Enums"]["coupon_duration"];
          duration_periods?: number | null;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_redemptions?: number | null;
          percent_off?: number | null;
          redeemed_count?: number;
          restricted_to_plan_ids?: string[] | null;
          whop_promo_code_id?: string | null;
        };
        Update: {
          is_active?: boolean;
          redeemed_count?: number;
          whop_promo_code_id?: string | null;
        };
        Relationships: [];
      };
      offers: {
        Row: {
          auto_apply: boolean;
          coupon_id: string;
          created_at: string;
          created_by: string | null;
          eligible_cycles: Database["public"]["Enums"]["billing_cycle"][];
          eligible_plan_ids: string[];
          eligible_plan_types: Database["public"]["Enums"]["plan_type"][];
          ends_at: string | null;
          existing_customers_only: boolean;
          id: string;
          is_active: boolean;
          max_redemptions: number | null;
          name: string;
          new_customers_only: boolean;
          redeemed_count: number;
          starts_at: string | null;
          updated_at: string;
        };
        Insert: {
          auto_apply?: boolean;
          coupon_id: string;
          created_at?: string;
          created_by?: string | null;
          eligible_cycles?: Database["public"]["Enums"]["billing_cycle"][];
          eligible_plan_ids?: string[];
          eligible_plan_types?: Database["public"]["Enums"]["plan_type"][];
          ends_at?: string | null;
          existing_customers_only?: boolean;
          id?: string;
          is_active?: boolean;
          max_redemptions?: number | null;
          name: string;
          new_customers_only?: boolean;
          redeemed_count?: number;
          starts_at?: string | null;
          updated_at?: string;
        };
        Update: {
          auto_apply?: boolean;
          eligible_cycles?: Database["public"]["Enums"]["billing_cycle"][];
          eligible_plan_ids?: string[];
          eligible_plan_types?: Database["public"]["Enums"]["plan_type"][];
          ends_at?: string | null;
          existing_customers_only?: boolean;
          is_active?: boolean;
          max_redemptions?: number | null;
          name?: string;
          new_customers_only?: boolean;
          starts_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscription_coupons: {
        Row: {
          applied_at: string;
          applied_by: string | null;
          coupon_id: string;
          id: string;
          is_active: boolean;
          periods_remaining: number | null;
          removed_at: string | null;
          subscription_id: string;
        };
        Insert: {
          applied_at?: string;
          applied_by?: string | null;
          coupon_id: string;
          id?: string;
          is_active?: boolean;
          periods_remaining?: number | null;
          removed_at?: string | null;
          subscription_id: string;
        };
        Update: {
          is_active?: boolean;
          periods_remaining?: number | null;
          removed_at?: string | null;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          id: string;
          invoice_id: string | null;
          manual_reference: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          paid_at: string;
          provider: string | null;
          provider_charge_id: string | null;
          recorded_by: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          tenant_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          id?: string;
          invoice_id?: string | null;
          manual_reference?: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          paid_at?: string;
          provider?: string | null;
          provider_charge_id?: string | null;
          recorded_by?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          tenant_id: string;
        };
        // Only status is updatable — the amount, method and references are fixed once recorded.
        Update: { status?: Database["public"]["Enums"]["payment_status"] };
        Relationships: [];
      };
      invoices: {
        Row: {
          created_at: string;
          created_by: string | null;
          kind: Database["public"]["Enums"]["invoice_kind"];
          pay_online_url: string | null;
          provider_invoice_id: string | null;
          reason: string | null;
          currency: string;
          discount_cents: number;
          due_at: string | null;
          id: string;
          issued_at: string | null;
          number: string;
          paid_at: string | null;
          period_end: string | null;
          period_start: string | null;
          provider: string | null;
          provider_payment_id: string | null;
          provider_total_cents: number | null;
          reconciliation: string;
          status: Database["public"]["Enums"]["invoice_status"];
          subscription_id: string | null;
          subtotal_cents: number;
          tax_cents: number;
          tenant_id: string;
          total_cents: number;
          void_reason: string | null;
          voided_at: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          kind?: Database["public"]["Enums"]["invoice_kind"];
          pay_online_url?: string | null;
          provider_invoice_id?: string | null;
          reason?: string | null;
          currency?: string;
          discount_cents?: number;
          due_at?: string | null;
          id?: string;
          issued_at?: string | null;
          number: string;
          paid_at?: string | null;
          period_end?: string | null;
          period_start?: string | null;
          provider?: string | null;
          provider_payment_id?: string | null;
          provider_total_cents?: number | null;
          reconciliation?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          subscription_id?: string | null;
          subtotal_cents?: number;
          tax_cents?: number;
          tenant_id: string;
          total_cents?: number;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        // Only the lifecycle columns are updatable — the money, the period and the number have
        // UPDATE revoked, so an issued invoice cannot be rewritten by any route.
        Update: {
          pay_online_url?: string | null;
          provider_invoice_id?: string | null;
          paid_at?: string | null;
          reconciliation?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Relationships: [];
      };
      invoice_lines: {
        Row: {
          amount_cents: number;
          created_at: string;
          id: string;
          included_qty: number | null;
          invoice_id: string;
          kind: Database["public"]["Enums"]["invoice_line_kind"];
          label: string;
          position: number;
          quantity: number;
          unit_cents: number;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          id?: string;
          included_qty?: number | null;
          invoice_id: string;
          kind: Database["public"]["Enums"]["invoice_line_kind"];
          label: string;
          position?: number;
          quantity?: number;
          unit_cents?: number;
        };
        // UPDATE and DELETE are both revoked: a line on an issued invoice is never edited or
        // removed. A correction is a credit line.
        Update: Record<string, never>;
        Relationships: [];
      };
      invoice_counters: {
        Row: { series: string; year: number; month: number; next_number: number };
        Insert: { series?: string; year: number; month: number; next_number?: number };
        Update: { series?: string; year?: number; month?: number; next_number?: number };
        Relationships: [];
      };
      whop_plans: {
        Row: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          created_at: string;
          id: string;
          plan_id: string;
          price_cents: number;
          whop_plan_id: string;
          whop_product_id: string | null;
        };
        Insert: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          created_at?: string;
          id?: string;
          plan_id: string;
          price_cents: number;
          whop_plan_id: string;
          whop_product_id?: string | null;
        };
        Update: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"];
          created_at?: string;
          id?: string;
          plan_id?: string;
          price_cents?: number;
          whop_plan_id?: string;
          whop_product_id?: string | null;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          attempts: number;
          event_id: string;
          event_type: string;
          id: string;
          occurred_at: string | null;
          payload: Json;
          process_error: string | null;
          processed_at: string | null;
          provider: string;
          received_at: string;
          tenant_id: string | null;
        };
        Insert: {
          attempts?: number;
          event_id: string;
          event_type: string;
          id?: string;
          occurred_at?: string | null;
          payload: Json;
          process_error?: string | null;
          processed_at?: string | null;
          provider?: string;
          received_at?: string;
          tenant_id?: string | null;
        };
        // Only tenant_id, processed_at, process_error and attempts are actually updatable —
        // UPDATE on the other columns is revoked so the recorded payload cannot be altered.
        Update: {
          attempts?: number;
          process_error?: string | null;
          processed_at?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [];
      };
      provider_settings: {
        Row: {
          created_at: string;
          display_label: string;
          is_default: boolean;
          is_enabled: boolean;
          provider: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_label: string;
          is_default?: boolean;
          is_enabled?: boolean;
          provider: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_label?: string;
          is_default?: boolean;
          is_enabled?: boolean;
          provider?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_providers: {
        Row: {
          created_at: string;
          id: string;
          is_default: boolean;
          payment_method_label: string | null;
          provider: string;
          provider_customer_id: string | null;
          simulate_outcome: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          payment_method_label?: string | null;
          provider: string;
          provider_customer_id?: string | null;
          simulate_outcome?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          payment_method_label?: string | null;
          provider?: string;
          provider_customer_id?: string | null;
          simulate_outcome?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      provider_calls: {
        Row: {
          duration_ms: number | null;
          id: string;
          idempotency_key: string | null;
          method: string;
          provider: string;
          request: Json;
          response: Json | null;
          status: string;
          tenant_id: string | null;
          ts: string;
        };
        Insert: {
          duration_ms?: number | null;
          id?: string;
          idempotency_key?: string | null;
          method: string;
          provider: string;
          request: Json;
          response?: Json | null;
          status: string;
          tenant_id?: string | null;
          ts?: string;
        };
        // UPDATE is revoked on this table — the type exists because Supabase generates it, but any
        // update will be refused by the database.
        Update: {
          duration_ms?: number | null;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          provider?: string;
          request?: Json;
          response?: Json | null;
          status?: string;
          tenant_id?: string | null;
          ts?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: Database["public"]["Enums"]["audit_actor_type"];
          id: string;
          ip: string | null;
          metadata: Json;
          reason: string | null;
          target_id: string | null;
          target_type: string | null;
          ts: string;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: Database["public"]["Enums"]["audit_actor_type"];
          id?: string;
          ip?: string | null;
          metadata?: Json;
          reason?: string | null;
          target_id?: string | null;
          target_type?: string | null;
          ts?: string;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: Database["public"]["Enums"]["audit_actor_type"];
          id?: string;
          ip?: string | null;
          metadata?: Json;
          reason?: string | null;
          target_id?: string | null;
          target_type?: string | null;
          ts?: string;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      feature_modules: {
        Row: {
          created_at: string;
          key: string;
          label: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          key: string;
          label: string;
          sort_order: number;
        };
        Update: {
          created_at?: string;
          key?: string;
          label?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      // HAND-ADDED by SA-4.10, not generated. feature_switches ships in
      // supabase/migrations/0014_feature_switches.sql; regenerate this file once that migration has
      // been applied and this block should come back identical.
      feature_switches: {
        Row: {
          feature_key: string;
          state: string;
          beta_tenant_ids: string[];
          off_message: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          feature_key: string;
          state?: string;
          beta_tenant_ids?: string[];
          off_message?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          feature_key?: string;
          state?: string;
          beta_tenant_ids?: string[];
          off_message?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      features: {
        Row: {
          created_at: string;
          description: string | null;
          feature_key: string;
          id: string;
          is_archived: boolean;
          label: string;
          module: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          feature_key: string;
          id?: string;
          is_archived?: boolean;
          label: string;
          module: string;
          sort_order?: number;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          feature_key?: string;
          id?: string;
          is_archived?: boolean;
          label?: string;
          module?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "features_module_fkey";
            columns: ["module"];
            isOneToOne: false;
            referencedRelation: "feature_modules";
            referencedColumns: ["key"];
          },
        ];
      };
      pipelines: {
        Row: { id: string; tenant_id: string; name: string; partner_type: Database["public"]["Enums"]["partner_type"]; is_default: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; name: string; partner_type: Database["public"]["Enums"]["partner_type"]; is_default?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; name?: string; partner_type?: Database["public"]["Enums"]["partner_type"]; is_default?: boolean; updated_at?: string };
        Relationships: [];
      };
      pipeline_stages: {
        Row: { id: string; pipeline_id: string; name: string; position: number; stage_type: string; color: string; is_archived: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; pipeline_id: string; name: string; position: number; stage_type: string; color: string; is_archived?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; pipeline_id?: string; name?: string; position?: number; stage_type?: string; color?: string; is_archived?: boolean; updated_at?: string };
        Relationships: [];
      };
      stage_dispositions: {
        Row: { id: string; tenant_id: string; stage_id: string; disposition_key: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; stage_id: string; disposition_key: string; created_at?: string; updated_at?: string };
        Update: { stage_id?: string; disposition_key?: string; updated_at?: string };
        Relationships: [];
      };
      plans: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          is_archived: boolean;
          is_public: boolean;
          is_default: boolean;
          name: string;
          plan_type: Database["public"]["Enums"]["plan_type"];
          sort_order: number;
          version: number;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_archived?: boolean;
          is_public?: boolean;
          is_default?: boolean;
          name: string;
          plan_type: Database["public"]["Enums"]["plan_type"];
          sort_order?: number;
          version?: number;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_archived?: boolean;
          is_public?: boolean;
          is_default?: boolean;
          name?: string;
          plan_type?: Database["public"]["Enums"]["plan_type"];
          sort_order?: number;
          version?: number;
        };
        Relationships: [];
      };
      products: {
        Row: {
          category: string;
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          category: string;
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          category?: string;
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_products: {
        Row: {
          tenant_id: string;
          product_code: string;
          is_enabled: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          product_code: string;
          is_enabled?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          product_code?: string;
          is_enabled?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      partner_products: {
        Row: { partner_id: string; product_code: string; approved_at: string; approved_by: string | null };
        Insert: { partner_id: string; product_code: string; approved_at?: string; approved_by?: string | null };
        Update: { approved_at?: string; approved_by?: string | null };
        Relationships: [];
      };
      plan_product_access: {
        Row: { plan_id: string; product_code: string; created_at: string };
        Insert: { plan_id: string; product_code: string; created_at?: string };
        Update: { plan_id?: string; product_code?: string; created_at?: string };
        Relationships: [];
      };
      tenant_templates: {
        Row: { id: string; tenant_id: string; template_id: string; template_version: number; definition_version: number; product_code: string; name: string; description: string | null; applied_at: string; applied_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; template_id: string; template_version: number; definition_version?: number; product_code: string; name: string; description?: string | null; applied_at?: string; applied_by?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; template_id?: string; template_version?: number; definition_version?: number; product_code?: string; name?: string; description?: string | null; applied_at?: string; applied_by?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      tenant_template_fields: {
        Row: { tenant_template_id: string; field_key: string; label: string; type: string; is_required: boolean; options: Json; sort_order: number; help_text: string | null; validation: Json };
        Insert: { tenant_template_id: string; field_key: string; label: string; type: string; is_required?: boolean; options?: Json; sort_order?: number; help_text?: string | null; validation?: Json };
        Update: { tenant_template_id?: string; field_key?: string; label?: string; type?: string; is_required?: boolean; options?: Json; sort_order?: number; help_text?: string | null; validation?: Json };
        Relationships: [];
      };
      tenant_template_stages: {
        Row: { tenant_template_id: string; stage_key: string; label: string; stage_type: string; color: string; sort_order: number };
        Insert: { tenant_template_id: string; stage_key: string; label: string; stage_type: string; color: string; sort_order?: number };
        Update: { tenant_template_id?: string; stage_key?: string; label?: string; stage_type?: string; color?: string; sort_order?: number };
        Relationships: [];
      };
      tenant_template_forms: {
        Row: { tenant_template_id: string; form_definition: Json };
        Insert: { tenant_template_id: string; form_definition: Json };
        Update: { tenant_template_id?: string; form_definition?: Json };
        Relationships: [];
      };
      tenant_template_revisions: {
        Row: { tenant_template_id: string; revision: number; name: string; description: string | null; fields: Json; stages: Json; form_definition: Json; created_by: string | null; created_at: string };
        Insert: { tenant_template_id: string; revision: number; name: string; description?: string | null; fields: Json; stages: Json; form_definition: Json; created_by?: string | null; created_at?: string };
        Update: { name?: string; description?: string | null; fields?: Json; stages?: Json; form_definition?: Json; created_by?: string | null };
        Relationships: [];
      };
      form_drafts: {
        Row: { id: string; tenant_id: string; partner_id: string | null; user_id: string; product_code: string; tenant_template_id: string; definition_version: number; payload: Json; created_at: string; updated_at: string; owner_key: string };
        Insert: { id?: string; tenant_id: string; partner_id?: string | null; user_id: string; product_code: string; tenant_template_id: string; definition_version: number; payload?: Json; created_at?: string; updated_at?: string; owner_key?: string };
        Update: { partner_id?: string | null; user_id?: string; product_code?: string; tenant_template_id?: string; definition_version?: number; payload?: Json; updated_at?: string };
        Relationships: [];
      };
      tenant_template_assignments: {
        Row: {
          id: string;
          tenant_id: string;
          product_code: string;
          template_id: string;
          template_version: number;
          assigned_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_code: string;
          template_id: string;
          template_version: number;
          assigned_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          product_code?: string;
          template_id?: string;
          template_version?: number;
          assigned_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      agent_leads: {
        Row: {
          id: string;
          partner_id: string | null;
          submission_id: string | null;
          affiliate_link_id: string | null;
          affiliate_campaign: string | null;
          tenant_id: string;
          tenant_template_id: string | null;
          definition_version: number;
          template_id: string;
          template_version: number;
          product_line: string;
          pipeline_id: string;
          stage_id: string;
          values: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          screening_result_id: string | null;
          screening_version: number | null;
          screening_outcome: string | null;
          screening_warning: string | null;
          screening_checked_at: string | null;
          screening_warning_acknowledged: boolean;
          screening_warning_acknowledged_at: string | null;
          duplicate_override_justification: string | null;
          duplicate_override_by: string | null;
          duplicate_override_at: string | null;
          callback_subtype: string | null;
        };
        Insert: {
          id?: string;
          partner_id?: string | null;
          submission_id?: string | null;
          affiliate_link_id?: string | null;
          affiliate_campaign?: string | null;
          tenant_id: string;
          tenant_template_id?: string | null;
          definition_version?: number;
          template_id: string;
          template_version: number;
          product_line: string;
          pipeline_id: string;
          stage_id: string;
          values?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          screening_result_id?: string | null;
          screening_version?: number | null;
          screening_outcome?: string | null;
          screening_warning?: string | null;
          screening_checked_at?: string | null;
          screening_warning_acknowledged?: boolean;
          screening_warning_acknowledged_at?: string | null;
          duplicate_override_justification?: string | null;
          duplicate_override_by?: string | null;
          duplicate_override_at?: string | null;
          callback_subtype?: string | null;
        };
        Update: {
          id?: string;
          partner_id?: string | null;
          submission_id?: string | null;
          affiliate_link_id?: string | null;
          affiliate_campaign?: string | null;
          tenant_id?: string;
          tenant_template_id?: string | null;
          definition_version?: number;
          template_id?: string;
          template_version?: number;
          product_line?: string;
          pipeline_id?: string;
          stage_id?: string;
          values?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          screening_result_id?: string | null;
          screening_version?: number | null;
          screening_outcome?: string | null;
          screening_warning?: string | null;
          screening_checked_at?: string | null;
          screening_warning_acknowledged?: boolean;
          screening_warning_acknowledged_at?: string | null;
          duplicate_override_justification?: string | null;
          duplicate_override_by?: string | null;
          duplicate_override_at?: string | null;
          callback_subtype?: string | null;
        };
        Relationships: [];
      };
      lead_queue: {
        Row: { id: string; tenant_id: string; lead_id: string; partner_id: string | null; affiliate_link_id: string | null; affiliate_campaign: string | null; product_line: string; pipeline_id: string; stage_id: string; status: string; claimed_by: string | null; owner_user_id: string | null; owner_role: string | null; claimed_at: string | null; submission_id: string | null; queued_at: string; disposition: string | null; disposition_at: string | null; disposition_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; lead_id: string; partner_id?: string | null; affiliate_link_id?: string | null; affiliate_campaign?: string | null; product_line: string; pipeline_id: string; stage_id: string; status?: string; claimed_by?: string | null; owner_user_id?: string | null; owner_role?: string | null; claimed_at?: string | null; submission_id?: string | null; queued_at?: string; disposition?: string | null; disposition_at?: string | null; disposition_by?: string | null; created_at?: string; updated_at?: string };
        Update: { pipeline_id?: string; stage_id?: string; status?: string; claimed_by?: string | null; owner_user_id?: string | null; owner_role?: string | null; claimed_at?: string | null; submission_id?: string | null; queued_at?: string; disposition?: string | null; disposition_at?: string | null; disposition_by?: string | null; updated_at?: string };
        Relationships: [];
      };
      verification_sessions: {
        Row: { id: string; tenant_id: string; work_item_id: string; lead_id: string; user_id: string; agent_role: string; status: string; started_at: string; ended_at: string | null; progress_percentage: number; completed_at: string | null; last_actor_id: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; work_item_id: string; lead_id: string; user_id: string; agent_role: string; status?: string; started_at?: string; ended_at?: string | null; progress_percentage?: number; completed_at?: string | null; last_actor_id?: string | null; created_at?: string; updated_at?: string };
        Update: { status?: string; ended_at?: string | null; progress_percentage?: number; completed_at?: string | null; last_actor_id?: string | null; updated_at?: string };
        Relationships: [];
      };
      verification_fields: {
        Row: { session_id: string; field_key: string; state: string; is_required: boolean; is_visible: boolean; old_value: Json | null; new_value: Json | null; confirmed_at: string | null; actor_id: string | null };
        Insert: { session_id: string; field_key: string; state?: string; is_required?: boolean; is_visible?: boolean; old_value?: Json | null; new_value?: Json | null; confirmed_at?: string | null; actor_id?: string | null };
        Update: { state?: string; is_required?: boolean; is_visible?: boolean; old_value?: Json | null; new_value?: Json | null; confirmed_at?: string | null; actor_id?: string | null };
        Relationships: [];
      };
      verification_field_changes: {
        Row: { id: string; tenant_id: string; session_id: string; lead_id: string; field_key: string; old_value: Json | null; new_value: Json | null; actor_id: string | null; created_at: string };
        Insert: { id?: string; tenant_id: string; session_id: string; lead_id: string; field_key: string; old_value?: Json | null; new_value?: Json | null; actor_id?: string | null; created_at?: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      active_calls: {
        Row: { id: string; tenant_id: string; work_item_id: string; lead_id: string; submission_id: string | null; user_id: string; agent_role: string; started_at: string; ended_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; work_item_id: string; lead_id: string; submission_id?: string | null; user_id: string; agent_role: string; started_at?: string; ended_at?: string | null; created_at?: string; updated_at?: string };
        Update: { ended_at?: string | null; updated_at?: string };
        Relationships: [];
      };
      agent_presence: {
        Row: { tenant_id: string; user_id: string; status: string; last_seen_at: string; updated_at: string };
        Insert: { tenant_id: string; user_id: string; status?: string; last_seen_at?: string; updated_at?: string };
        Update: { status?: string; last_seen_at?: string; updated_at?: string };
        Relationships: [];
      };
      agent_floor_nudges: {
        Row: { id: string; tenant_id: string; work_item_id: string; target_user_id: string | null; created_by: string; idempotency_key: string; message: string; created_at: string };
        Insert: { id?: string; tenant_id: string; work_item_id: string; target_user_id?: string | null; created_by: string; idempotency_key: string; message?: string; created_at?: string };
        Update: { message?: string };
        Relationships: [];
      };
      partner_messages: {
        Row: { id: string; tenant_id: string; partner_id: string; channel_id: string; work_item_id: string | null; message: string; message_kind: string; card_type: string | null; card_payload: Json; event_key: string | null; created_by: string | null; created_at: string };
        Insert: { id?: string; tenant_id: string; partner_id: string; channel_id: string; work_item_id?: string | null; message: string; message_kind?: string; card_type?: string | null; card_payload?: Json; event_key?: string | null; created_by?: string | null; created_at?: string };
        Update: { message?: string };
        Relationships: [];
      };
      partner_channels: {
        Row: { id: string; tenant_id: string; partner_id: string; channel_type: string; name: string; status: string; created_by: string | null; created_at: string; archived_at: string | null };
        Insert: { id?: string; tenant_id: string; partner_id: string; channel_type?: string; name?: string; status?: string; created_by?: string | null; created_at?: string; archived_at?: string | null };
        Update: { name?: string; status?: string; archived_at?: string | null };
        Relationships: [];
      };
      partner_message_reads: {
        Row: { channel_id: string; tenant_id: string; user_id: string; read_at: string };
        Insert: { channel_id: string; tenant_id: string; user_id: string; read_at?: string };
        Update: { read_at?: string };
        Relationships: [];
      };
      partner_message_mentions: {
        Row: { id: string; tenant_id: string; message_id: string; mentioned_user_id: string; created_at: string };
        Insert: { id?: string; tenant_id: string; message_id: string; mentioned_user_id: string; created_at?: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      partner_message_attachments: {
        Row: { id: string; tenant_id: string; message_id: string; file_name: string; storage_path: string; content_type: string; size_bytes: number; created_by: string | null; created_at: string };
        Insert: { id?: string; tenant_id: string; message_id: string; file_name: string; storage_path: string; content_type: string; size_bytes: number; created_by?: string | null; created_at?: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      deal_flow: {
        Row: { id: string; tenant_id: string; lead_id: string; partner_id: string | null; affiliate_link_id: string | null; affiliate_campaign: string | null; submission_id: string | null; product_line: string; pipeline_id: string; stage_id: string; insured_name: string | null; phone: string | null; initial_quote: string | null; tracking_id: string | null; local_date: string; status: string; call_result: string | null; notes: string | null; disposition_at: string | null; disposition_by: string | null; carrier: string | null; product_type: string | null; monthly_premium_cents: number | null; face_amount_cents: number | null; draft_date: string | null; worked_by: string | null; manual_entry: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; lead_id: string; partner_id?: string | null; affiliate_link_id?: string | null; affiliate_campaign?: string | null; submission_id?: string | null; product_line: string; pipeline_id: string; stage_id: string; insured_name?: string | null; phone?: string | null; initial_quote?: string | null; tracking_id?: string | null; local_date: string; status?: string; call_result?: string | null; notes?: string | null; disposition_at?: string | null; disposition_by?: string | null; carrier?: string | null; product_type?: string | null; monthly_premium_cents?: number | null; face_amount_cents?: number | null; draft_date?: string | null; worked_by?: string | null; manual_entry?: boolean; created_at?: string; updated_at?: string };
        Update: { pipeline_id?: string; stage_id?: string; insured_name?: string | null; phone?: string | null; initial_quote?: string | null; tracking_id?: string | null; local_date?: string; status?: string; call_result?: string | null; notes?: string | null; carrier?: string | null; product_type?: string | null; monthly_premium_cents?: number | null; face_amount_cents?: number | null; draft_date?: string | null; worked_by?: string | null; manual_entry?: boolean; disposition_at?: string | null; disposition_by?: string | null; updated_at?: string };
        Relationships: [];
      };
      dispositions: {
        Row: { id: string; tenant_id: string; disposition_key: string; label: string; counts_as_work_completed: boolean; closes_as: string; is_active: boolean; sort_order: number; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; disposition_key: string; label: string; counts_as_work_completed?: boolean; closes_as?: string; is_active?: boolean; sort_order?: number; created_at?: string; updated_at?: string };
        Update: { label?: string; counts_as_work_completed?: boolean; closes_as?: string; is_active?: boolean; sort_order?: number; updated_at?: string };
        Relationships: [];
      };
      disposition_flows: {
        Row: { id: string; tenant_id: string; stage_id: string; name: string; is_active: boolean; root_node_id: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; stage_id: string; name: string; is_active?: boolean; root_node_id?: string | null; created_at?: string; updated_at?: string };
        Update: { name?: string; is_active?: boolean; root_node_id?: string | null; updated_at?: string };
        Relationships: [];
      };
      disposition_nodes: {
        Row: { id: string; flow_id: string; node_key: string; label: string; prompt: string; node_type: string; field_key: string | null; note_template: string | null; next_node_id: string | null; sort_order: number; created_at: string; updated_at: string };
        Insert: { id?: string; flow_id: string; node_key: string; label: string; prompt: string; node_type: string; field_key?: string | null; note_template?: string | null; next_node_id?: string | null; sort_order?: number; created_at?: string; updated_at?: string };
        Update: { label?: string; prompt?: string; node_type?: string; note_template?: string | null; next_node_id?: string | null; updated_at?: string };
        Relationships: [];
      };
      disposition_options: {
        Row: { id: string; node_id: string; option_key: string; label: string; next_node_id: string | null; disposition_key: string | null; note_template: string | null; sort_order: number; created_at: string; updated_at: string };
        Insert: { id?: string; node_id: string; option_key: string; label: string; next_node_id?: string | null; disposition_key?: string | null; note_template?: string | null; sort_order?: number; created_at?: string; updated_at?: string };
        Update: { label?: string; next_node_id?: string | null; disposition_key?: string | null; note_template?: string | null; updated_at?: string };
        Relationships: [];
      };
      disposition_walks: {
        Row: { id: string; tenant_id: string; work_item_id: string; lead_id: string; flow_id: string; user_id: string; status: string; current_node_id: string | null; final_disposition_key: string | null; composed_note: string | null; started_at: string; completed_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; work_item_id: string; lead_id: string; flow_id: string; user_id: string; status?: string; current_node_id?: string | null; final_disposition_key?: string | null; composed_note?: string | null; started_at?: string; completed_at?: string | null; created_at?: string; updated_at?: string };
        Update: { user_id?: string; status?: string; current_node_id?: string | null; final_disposition_key?: string | null; composed_note?: string | null; completed_at?: string | null; updated_at?: string };
        Relationships: [];
      };
      disposition_walk_steps: {
        Row: { id: string; walk_id: string; sequence: number; node_id: string; answer: Json; option_key: string | null; note_fragment: string; created_at: string; updated_at: string };
        Insert: { id?: string; walk_id: string; sequence: number; node_id: string; answer?: Json; option_key?: string | null; note_fragment?: string; created_at?: string; updated_at?: string };
        Update: { answer?: Json; option_key?: string | null; note_fragment?: string; updated_at?: string };
        Relationships: [];
      };
      tenant_do_not_call: {
        Row: { id: string; tenant_id: string; phone_digits: string; lead_id: string | null; added_by: string | null; reason: string; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; phone_digits: string; lead_id?: string | null; added_by?: string | null; reason?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { reason?: string; is_active?: boolean; updated_at?: string };
        Relationships: [];
      };
      affiliate_links: {
        Row: { id: string; tenant_id: string; partner_id: string; slug: string; campaign: string | null; is_active: boolean; click_count: number; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; partner_id: string; slug: string; campaign?: string | null; is_active?: boolean; click_count?: number; created_at?: string; updated_at?: string };
        Update: { slug?: string; campaign?: string | null; is_active?: boolean; click_count?: number; updated_at?: string };
        Relationships: [];
      };
      intake_failures: {
        Row: { id: string; tenant_id: string; lead_id: string; step: string; error_message: string; metadata: Json; created_at: string; resolved_at: string | null };
        Insert: { id?: string; tenant_id: string; lead_id: string; step: string; error_message: string; metadata?: Json; created_at?: string; resolved_at?: string | null };
        Update: { resolved_at?: string | null };
        Relationships: [];
      };
      intake_alerts: {
        Row: { id: string; tenant_id: string; intake_failure_id: string; alert_type: string; status: string; created_at: string; acknowledged_at: string | null };
        Insert: { id?: string; tenant_id: string; intake_failure_id: string; alert_type?: string; status?: string; created_at?: string; acknowledged_at?: string | null };
        Update: { status?: string; acknowledged_at?: string | null };
        Relationships: [];
      };
      lead_notifications: {
        Row: { id: string; tenant_id: string; lead_id: string; channel: string; event_type: string; payload: Json; status: string; created_at: string; sent_at: string | null };
        Insert: { id?: string; tenant_id: string; lead_id: string; channel?: string; event_type?: string; payload?: Json; status?: string; created_at?: string; sent_at?: string | null };
        Update: { status?: string; sent_at?: string | null };
        Relationships: [];
      };
      partners: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          partner_type: Database["public"]["Enums"]["partner_type"];
          status: Database["public"]["Enums"]["partner_status"];
          country: string;
          contact_name: string | null;
          contact_email: string | null;
          timezone: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          paused_at: string | null;
          offboarded_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          partner_type: Database["public"]["Enums"]["partner_type"];
          status?: Database["public"]["Enums"]["partner_status"];
          country?: string;
          contact_name?: string | null;
          contact_email?: string | null;
          timezone?: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          paused_at?: string | null;
          offboarded_at?: string | null;
        };
        Update: {
          name?: string;
          partner_type?: Database["public"]["Enums"]["partner_type"];
          status?: Database["public"]["Enums"]["partner_status"];
          country?: string;
          contact_name?: string | null;
          contact_email?: string | null;
          timezone?: string;
          notes?: string | null;
          updated_at?: string;
          paused_at?: string | null;
          offboarded_at?: string | null;
        };
        Relationships: [];
      };
      partner_terms: {
        Row: {
          id: string;
          partner_id: string;
          payout_model: Database["public"]["Enums"]["partner_payout_model"];
          rate_cents: number | null;
          rate_pct_bp: number | null;
          effective_from: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          partner_id: string;
          payout_model: Database["public"]["Enums"]["partner_payout_model"];
          rate_cents?: number | null;
          rate_pct_bp?: number | null;
          effective_from: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      partner_users: {
        Row: {
          id: string;
          tenant_id: string;
          partner_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["partner_user_role"];
          status: Database["public"]["Enums"]["partner_user_status"];
          invited_at: string;
          revoked_at: string | null;
          accepted_at: string | null;
          deactivated_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          partner_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["partner_user_role"];
          status?: Database["public"]["Enums"]["partner_user_status"];
          invited_at?: string;
          revoked_at?: string | null;
          accepted_at?: string | null;
          deactivated_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          status?: Database["public"]["Enums"]["partner_user_status"];
          revoked_at?: string | null;
          role?: Database["public"]["Enums"]["partner_user_role"];
          accepted_at?: string | null;
          deactivated_at?: string | null;
        };
        Relationships: [];
      };
      households: {
        Row: { id: string; tenant_id: string; address_hash: string | null; address_line1: string | null; city: string | null; state: string | null; postal_code: string | null; address_search: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; address_hash?: string | null; address_line1?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; address_search?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; address_hash?: string | null; address_line1?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; address_search?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      contacts: {
        Row: { id: string; tenant_id: string; household_id: string | null; first_name: string; last_name: string; dob: string | null; primary_phone: string | null; state: string | null; name_search: string; custom_fields: Json; merged_into_id: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; household_id?: string | null; first_name: string; last_name: string; dob?: string | null; primary_phone?: string | null; state?: string | null; name_search: string; custom_fields?: Json; merged_into_id?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; household_id?: string | null; first_name?: string; last_name?: string; dob?: string | null; primary_phone?: string | null; state?: string | null; name_search?: string; custom_fields?: Json; merged_into_id?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      contact_phones: {
        Row: { id: string; tenant_id: string; contact_id: string; phone: string; type: string; is_primary: boolean; created_at: string };
        Insert: { id?: string; tenant_id: string; contact_id: string; phone: string; type?: string; is_primary?: boolean; created_at?: string };
        Update: { id?: string; tenant_id?: string; contact_id?: string; phone?: string; type?: string; is_primary?: boolean; created_at?: string };
        Relationships: [];
      };
      contact_emails: {
        Row: { id: string; tenant_id: string; contact_id: string; email: string; is_primary: boolean; created_at: string };
        Insert: { id?: string; tenant_id: string; contact_id: string; email: string; is_primary?: boolean; created_at?: string };
        Update: { id?: string; tenant_id?: string; contact_id?: string; email?: string; is_primary?: boolean; created_at?: string };
        Relationships: [];
      };
      field_schema: {
        Row: { id: string; tenant_id: string; entity: string; field_key: string; label: string; type: string; options: Json; is_required: boolean; sort_order: number; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; entity: string; field_key: string; label: string; type: string; options?: Json; is_required?: boolean; sort_order?: number; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; entity?: string; field_key?: string; label?: string; type?: string; options?: Json; is_required?: boolean; sort_order?: number; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      merge_log: {
        Row: { id: string; tenant_id: string; kept_id: string; merged_id: string; field_choices: Json; kept_snapshot: Json; merged_snapshot: Json; kept_phones: Json; merged_phones: Json; kept_emails: Json; merged_emails: Json; merged_by: string | null; merged_at: string; reversed_at: string | null };
        Insert: { id?: string; tenant_id: string; kept_id: string; merged_id: string; field_choices?: Json; kept_snapshot: Json; merged_snapshot: Json; kept_phones?: Json; merged_phones?: Json; kept_emails?: Json; merged_emails?: Json; merged_by?: string | null; merged_at?: string; reversed_at?: string | null };
        Update: { id?: string; tenant_id?: string; kept_id?: string; merged_id?: string; field_choices?: Json; kept_snapshot?: Json; merged_snapshot?: Json; kept_phones?: Json; merged_phones?: Json; kept_emails?: Json; merged_emails?: Json; merged_by?: string | null; reversed_at?: string | null };
        Relationships: [];
      };
      templates: {
        Row: {
          id: string;
          name: string;
          product_code: string;
          version: number;
          description: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          product_code: string;
          version?: number;
          description?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          product_code?: string;
          version?: number;
          description?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      template_fields: {
        Row: {
          template_id: string;
          version: number;
          field_key: string;
          label: string;
          type: string;
          is_required: boolean;
          options: Json;
          sort_order: number;
          help_text: string | null;
          validation: Json;
        };
        Insert: {
          template_id: string;
          version: number;
          field_key: string;
          label: string;
          type: string;
          is_required?: boolean;
          options?: Json;
          sort_order?: number;
          help_text?: string | null;
          validation?: Json;
        };
        Update: {
          template_id?: string;
          version?: number;
          field_key?: string;
          label?: string;
          type?: string;
          is_required?: boolean;
          options?: Json;
          sort_order?: number;
          help_text?: string | null;
          validation?: Json;
        };
        Relationships: [];
      };
      template_stages: {
        Row: {
          template_id: string;
          version: number;
          stage_key: string;
          label: string;
          stage_type: string;
          color: string;
          sort_order: number;
        };
        Insert: {
          template_id: string;
          version: number;
          stage_key: string;
          label: string;
          stage_type: string;
          color: string;
          sort_order?: number;
        };
        Update: {
          template_id?: string;
          version?: number;
          stage_key?: string;
          label?: string;
          stage_type?: string;
          color?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      template_forms: {
        Row: {
          template_id: string;
          version: number;
          form_definition: Json;
        };
        Insert: {
          template_id: string;
          version: number;
          form_definition: Json;
        };
        Update: {
          template_id?: string;
          version?: number;
          form_definition?: Json;
        };
        Relationships: [];
      };
      plan_features: {
        Row: {
          created_at: string;
          feature_key: string;
          plan_id: string;
        };
        Insert: {
          created_at?: string;
          feature_key: string;
          plan_id: string;
        };
        Update: {
          created_at?: string;
          feature_key?: string;
          plan_id?: string;
        };
        Relationships: [];
      };
      addons: {
        Row: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          price_cents: number;
          sort_order: number;
        };
        Insert: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"];
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          price_cents: number;
          sort_order?: number;
        };
        Update: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"];
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          price_cents?: number;
          sort_order?: number;
        };
        Relationships: [];
      };
      addon_features: {
        Row: { addon_id: string; feature_key: string };
        Insert: { addon_id: string; feature_key: string };
        Update: { addon_id?: string; feature_key?: string };
        Relationships: [];
      };
      addon_meters: {
        Row: { addon_id: string; included_qty: number; meter_key: string };
        Insert: { addon_id: string; included_qty: number; meter_key: string };
        Update: { addon_id?: string; included_qty?: number; meter_key?: string };
        Relationships: [];
      };
      plan_available_addons: {
        Row: { addon_id: string; plan_id: string };
        Insert: { addon_id: string; plan_id: string };
        Update: { addon_id?: string; plan_id?: string };
        Relationships: [];
      };
      subscription_addons: {
        Row: {
          addon_id: string;
          attached_at: string;
          attached_by: string | null;
          availability_overridden: boolean;
          detached_at: string | null;
          id: string;
          subscription_id: string;
        };
        Insert: {
          addon_id: string;
          attached_at?: string;
          attached_by?: string | null;
          availability_overridden?: boolean;
          detached_at?: string | null;
          id?: string;
          subscription_id: string;
        };
        Update: {
          addon_id?: string;
          attached_at?: string;
          attached_by?: string | null;
          availability_overridden?: boolean;
          detached_at?: string | null;
          id?: string;
          subscription_id?: string;
        };
        Relationships: [];
      };
      tenant_entitlements: {
        Row: { computed_at: string; entitlement: Json; tenant_id: string; version: number };
        Insert: { computed_at?: string; entitlement: Json; tenant_id: string; version?: number };
        Update: { computed_at?: string; entitlement?: Json; tenant_id?: string; version?: number };
        Relationships: [];
      };
      meters: {
        Row: {
          default_hard_cap: boolean;
          label: string;
          meter_key: string;
          sort_order: number;
          unit: string;
        };
        Insert: {
          default_hard_cap?: boolean;
          label: string;
          meter_key: string;
          sort_order?: number;
          unit: string;
        };
        Update: {
          default_hard_cap?: boolean;
          label?: string;
          meter_key?: string;
          sort_order?: number;
          unit?: string;
        };
        Relationships: [];
      };
      plan_meters: {
        Row: { hard_cap: boolean; included_qty: number | null; meter_key: string; plan_id: string };
        Insert: { hard_cap?: boolean; included_qty?: number | null; meter_key: string; plan_id: string };
        Update: { hard_cap?: boolean; included_qty?: number | null; meter_key?: string; plan_id?: string };
        Relationships: [];
      };
      plan_limits: {
        Row: { max_affiliates: number | null; max_buffer_seats: number | null; max_carriers: number | null; max_marketing_partners: number | null; max_partner_users: number | null; max_publishers: number | null; max_seats: number | null; plan_id: string };
        Insert: { max_affiliates?: number | null; max_buffer_seats?: number | null; max_carriers?: number | null; max_marketing_partners?: number | null; max_partner_users?: number | null; max_publishers?: number | null; max_seats?: number | null; plan_id: string };
        Update: { max_affiliates?: number | null; max_buffer_seats?: number | null; max_carriers?: number | null; max_marketing_partners?: number | null; max_partner_users?: number | null; max_publishers?: number | null; max_seats?: number | null; plan_id?: string };
        Relationships: [];
      };
      usage_events: {
        Row: {
          id: string;
          idempotency_key: string;
          meter_key: string;
          period_start: string;
          qty: number;
          ref: string | null;
          tenant_id: string;
          ts: string;
        };
        Insert: {
          id?: string;
          idempotency_key: string;
          meter_key: string;
          period_start: string;
          qty: number;
          ref?: string | null;
          tenant_id: string;
          ts?: string;
        };
        Update: never;
        Relationships: [];
      };
      usage_totals: {
        Row: {
          meter_key: string;
          period_start: string;
          tenant_id: string;
          updated_at: string;
          used_qty: number;
        };
        Insert: {
          meter_key: string;
          period_start: string;
          tenant_id: string;
          updated_at?: string;
          used_qty?: number;
        };
        Update: {
          meter_key?: string;
          period_start?: string;
          tenant_id?: string;
          updated_at?: string;
          used_qty?: number;
        };
        Relationships: [];
      };
      plan_prices: {
        Row: {
          currency: string;
          plan_id: string;
          price_monthly_cents: number | null;
          price_quarterly_cents: number | null;
          price_yearly_cents: number | null;
          setup_fee_cents: number;
          trial_days: number;
          updated_at: string;
        };
        Insert: {
          currency?: string;
          plan_id: string;
          price_monthly_cents?: number | null;
          price_quarterly_cents?: number | null;
          price_yearly_cents?: number | null;
          setup_fee_cents?: number;
          trial_days?: number;
          updated_at?: string;
        };
        Update: {
          currency?: string;
          plan_id?: string;
          price_monthly_cents?: number | null;
          price_quarterly_cents?: number | null;
          price_yearly_cents?: number | null;
          setup_fee_cents?: number;
          trial_days?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      signup_selections: {
        Row: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          plan_id: string;
          selected_at: string;
          tenant_id: string;
        };
        Insert: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          plan_id: string;
          selected_at?: string;
          tenant_id: string;
        };
        Update: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"];
          plan_id?: string;
          selected_at?: string;
          tenant_id?: string;
        };
        Relationships: [];
      };
      business_profiles: {
        Row: {
          business_name: string;
          completed_at: string;
          lead_source_other: string | null;
          lead_sources: string[];
          monthly_volume_range: string;
          npn: string;
          primary_state: string;
          products_sold: string[];
          recommended_setup_steps: string[];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          business_name: string;
          completed_at?: string;
          lead_source_other?: string | null;
          lead_sources: string[];
          monthly_volume_range: string;
          npn: string;
          primary_state: string;
          products_sold: string[];
          recommended_setup_steps?: string[];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          business_name?: string;
          completed_at?: string;
          lead_source_other?: string | null;
          lead_sources?: string[];
          monthly_volume_range?: string;
          npn?: string;
          primary_state?: string;
          products_sold?: string[];
          recommended_setup_steps?: string[];
          tenant_id?: string;
        };
        Relationships: [];
      };
      // HAND-ADDED for the period billing run (backlog #41/#44/#46), not generated. Both tables
      // ship in supabase/migrations/0017_period_billing.sql; regenerate this file once that
      // migration has been applied and these blocks should come back identical.
      pending_charges: {
        Row: {
          id: string;
          tenant_id: string;
          subscription_id: string;
          kind: string;
          label: string;
          quantity: number;
          included_qty: number | null;
          unit_cents: number;
          amount_cents: number;
          reason: string;
          created_at: string;
          created_by: string | null;
          invoice_id: string | null;
          billed_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          subscription_id: string;
          kind: string;
          label: string;
          quantity?: number;
          included_qty?: number | null;
          unit_cents?: number;
          amount_cents: number;
          reason: string;
          created_at?: string;
          created_by?: string | null;
          invoice_id?: string | null;
          billed_at?: string | null;
        };
        Update: {
          invoice_id?: string | null;
          billed_at?: string | null;
        };
        Relationships: [];
      };
      period_billing_runs: {
        Row: {
          subscription_id: string;
          period_start: string;
          period_end: string;
          invoice_id: string | null;
          total_cents: number;
          line_count: number;
          note: string | null;
          ran_at: string;
        };
        Insert: {
          subscription_id: string;
          period_start: string;
          period_end: string;
          invoice_id?: string | null;
          total_cents?: number;
          line_count?: number;
          note?: string | null;
          ran_at?: string;
        };
        Update: {
          invoice_id?: string | null;
          note?: string | null;
        };
        Relationships: [];
      };
      // HAND-ADDED by SA-4.1, not generated. The `settings` table ships in
      // supabase/migrations/0001_settings.sql; regenerate this file once that migration has been
      // applied to the project and this block should come back identical.
      settings: {
        Row: {
          key: string;
          value: Json;
          type: string;
          label: string;
          group: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          type: string;
          label: string;
          group: string;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          type?: string;
          label?: string;
          group?: string;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          cancel_at_period_end: boolean;
          cancel_reason: string | null;
          cancelled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string;
          id: string;
          last_provider_event_at: string | null;
          whop_membership_id: string | null;
          pending_plan_id: string | null;
          plan_id: string;
          started_at: string;
          status: Database["public"]["Enums"]["subscription_status"];
          tenant_id: string;
          trial_ends_at: string | null;
        };
        Insert: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"];
          cancel_at_period_end?: boolean;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string;
          id?: string;
          last_provider_event_at?: string | null;
          whop_membership_id?: string | null;
          pending_plan_id?: string | null;
          plan_id: string;
          started_at?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          tenant_id: string;
          trial_ends_at?: string | null;
        };
        Update: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"];
          cancel_at_period_end?: boolean;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string;
          id?: string;
          last_provider_event_at?: string | null;
          whop_membership_id?: string | null;
          pending_plan_id?: string | null;
          plan_id?: string;
          started_at?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          tenant_id?: string;
          trial_ends_at?: string | null;
        };
        Relationships: [];
      };
      login_events: {
        Row: {
          actor_type: Database["public"]["Enums"]["login_actor_type"];
          admin_id: string | null;
          email: string;
          failure_reason: string | null;
          id: string;
          ip: string | null;
          success: boolean;
          ts: string;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          actor_type: Database["public"]["Enums"]["login_actor_type"];
          admin_id?: string | null;
          email: string;
          failure_reason?: string | null;
          id?: string;
          ip?: string | null;
          success: boolean;
          ts?: string;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          actor_type?: Database["public"]["Enums"]["login_actor_type"];
          admin_id?: string | null;
          email?: string;
          failure_reason?: string | null;
          id?: string;
          ip?: string | null;
          success?: boolean;
          ts?: string;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      tenant_users: {
        Row: {
          accepted_at: string | null;
          invited_at: string;
          role: Database["public"]["Enums"]["tenant_user_role"];
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          invited_at?: string;
          role: Database["public"]["Enums"]["tenant_user_role"];
          tenant_id: string;
          user_id: string;
        };
        Update: {
          accepted_at?: string | null;
          invited_at?: string;
          role?: Database["public"]["Enums"]["tenant_user_role"];
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_users_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_users_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          billing_mode: Database["public"]["Enums"]["billing_mode"];
          created_at: string;
          id: string;
          name: string;
          onboarding_state: string;
          plan_code: string | null;
          status: Database["public"]["Enums"]["tenant_status"];
          suspended_at: string | null;
        };
        Insert: {
          billing_mode?: Database["public"]["Enums"]["billing_mode"];
          created_at?: string;
          id?: string;
          name: string;
          onboarding_state?: string;
          plan_code?: string | null;
          status?: Database["public"]["Enums"]["tenant_status"];
          suspended_at?: string | null;
        };
        Update: {
          billing_mode?: Database["public"]["Enums"]["billing_mode"];
          created_at?: string;
          id?: string;
          name?: string;
          onboarding_state?: string;
          plan_code?: string | null;
          status?: Database["public"]["Enums"]["tenant_status"];
          suspended_at?: string | null;
        };
        Relationships: [];
      };
      users: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          last_login_at: string | null;
          name: string;
          // Null until an invited user sets one via their invite link (SA-1.2).
          password_hash: string | null;
          phone: string | null;
          status: Database["public"]["Enums"]["user_status"];
          suspended_at: string | null;
          suspension_reason: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          last_login_at?: string | null;
          name: string;
          password_hash?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["user_status"];
          suspended_at?: string | null;
          suspension_reason?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          last_login_at?: string | null;
          name?: string;
          password_hash?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["user_status"];
          suspended_at?: string | null;
          suspension_reason?: string | null;
        };
        Relationships: [];
      };
      user_invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          new_email: string | null;
          purpose: Database["public"]["Enums"]["user_token_purpose"];
          token_hash: string;
          user_id: string;
          partner_id: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          new_email?: string | null;
          purpose?: Database["public"]["Enums"]["user_token_purpose"];
          token_hash: string;
          user_id: string;
          partner_id?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          new_email?: string | null;
          purpose?: Database["public"]["Enums"]["user_token_purpose"];
          token_hash?: string;
          user_id?: string;
          partner_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      current_legal_documents: {
        Row: {
          change_summary: string | null;
          doc_type: Database["public"]["Enums"]["legal_doc_type"];
          effective_date: string;
          id: string;
          is_draft: boolean;
          published_at: string;
          requires_reacceptance: boolean;
          title: string;
          version: number;
        };
        Relationships: [];
      };
      admin_legal_acceptance_stats: {
        Row: {
          accepted_count: number;
          doc_type: Database["public"]["Enums"]["legal_doc_type"];
          document_id: string;
          eligible_users: number;
          is_draft: boolean;
          published_at: string;
          requires_reacceptance: boolean;
          title: string;
          version: number;
        };
        Relationships: [];
      };
      admin_trials_in_flight: {
        Row: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          business_name: string | null;
          days_elapsed: number;
          days_remaining: number;
          has_payment_method: boolean;
          last_login_at: string | null;
          owner_email: string | null;
          owner_name: string | null;
          plan_code: string;
          plan_name: string;
          started_at: string;
          subscription_id: string;
          tenant_id: string;
          tenant_name: string;
          trial_ends_at: string;
        };
        Relationships: [];
      };
      admin_plan_list: {
        Row: {
          code: string | null;
          created_at: string | null;
          description: string | null;
          ever_subscribed_count: number | null;
          id: string | null;
          is_archived: boolean | null;
          is_public: boolean | null;
          is_default: boolean | null;
          name: string | null;
          plan_type: Database["public"]["Enums"]["plan_type"] | null;
          sort_order: number | null;
          subscriber_count: number | null;
          version: number | null;
          version_count: number | null;
        };
        Relationships: [];
      };
      admin_user_list: {
        Row: {
          created_at: string | null;
          email: string | null;
          has_password: boolean | null;
          id: string | null;
          last_login_at: string | null;
          name: string | null;
          phone: string | null;
          plan_code: string | null;
          distinct_ips_24h: number | null;
          status: Database["public"]["Enums"]["user_status"] | null;
          suspended_at: string | null;
          suspension_reason: string | null;
          tenant_id: string | null;
          tenant_name: string | null;
          tenant_role: Database["public"]["Enums"]["tenant_user_role"] | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      archive_pipeline_stage: {
        Args: { p_stage_id: string; p_tenant_id: string };
        Returns: { id: string; pipeline_id: string; name: string; position: number; stage_type: string; color: string; is_archived: boolean; created_at: string; updated_at: string };
      };
      reorder_pipeline_stages: {
        Args: { p_pipeline_id: string; p_stage_ids: string[]; p_tenant_id: string };
        Returns: { id: string; pipeline_id: string; name: string; position: number; stage_type: string; color: string; is_archived: boolean; created_at: string; updated_at: string }[];
      };
      set_stage_disposition: {
        Args: { p_disposition_key: string; p_stage_id: string; p_tenant_id: string };
        Returns: { id: string; tenant_id: string; stage_id: string; disposition_key: string; created_at: string; updated_at: string };
      };
      move_lead_to_disposition: {
        Args: { p_disposition_key: string; p_lead_id: string; p_tenant_id: string };
        Returns: { lead_id: string; pipeline_id: string; stage_id: string }[];
      };
      self_serve_signup: {
        Args: {
          p_billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          p_email: string;
          p_expires_at: string;
          p_name: string;
          p_password_hash: string;
          p_phone: string;
          p_plan_id: string;
          p_token_hash: string;
        };
        Returns: { tenant_id: string; user_id: string; verification_id: string }[];
      };
      complete_signup_email_verification: {
        Args: { p_token_hash: string };
        Returns: { email: string; tenant_id: string; user_id: string }[];
      };
      refresh_signup_verification: {
        Args: {
          p_expires_at: string;
          p_new_email: string;
          p_token_hash: string;
          p_user_id: string;
        };
        Returns: { email: string; verification_id: string }[];
      };
      save_signup_business_profile: {
        Args: {
          p_business_name: string;
          p_lead_source_other: string;
          p_lead_sources: string[];
          p_monthly_volume_range: string;
          p_npn: string;
          p_primary_state: string;
          p_products_sold: string[];
          p_recommended_setup_steps: string[];
          p_user_id: string;
        };
        Returns: { onboarding_state: string; tenant_id: string }[];
      };
      admin_create_user: {
        Args: {
          p_created_by: string;
          p_email: string;
          p_expires_at: string;
          p_name: string;
          p_new_tenant_name: string | null;
          p_phone: string | null;
          p_role: Database["public"]["Enums"]["tenant_user_role"];
          p_tenant_id: string | null;
          p_token_hash: string;
        };
        Returns: {
          tenant_id: string;
          user_id: string;
        }[];
      };
      admin_update_user: {
        Args: {
          p_name: string;
          p_phone: string | null;
          p_role: Database["public"]["Enums"]["tenant_user_role"];
          p_user_id: string;
        };
        Returns: {
          new_name: string;
          new_phone: string;
          new_role: Database["public"]["Enums"]["tenant_user_role"];
          old_name: string;
          old_phone: string;
          old_role: Database["public"]["Enums"]["tenant_user_role"];
        }[];
      };
      tenant_invite_user: {
        Args: {
          p_created_by: string;
          p_email: string;
          p_expires_at: string;
          p_name: string;
          p_role: Database["public"]["Enums"]["tenant_user_role"];
          p_tenant_id: string;
          p_token_hash: string;
        };
        Returns: { tenant_id: string; user_id: string }[];
      };
      tenant_invite_user_with_limit: {
        Args: { p_created_by: string; p_email: string; p_expires_at: string; p_max_buffer_seats?: number | null; p_name: string; p_role: Database["public"]["Enums"]["tenant_user_role"]; p_tenant_id: string; p_token_hash: string };
        Returns: { tenant_id: string; user_id: string }[];
      };
      tenant_update_member_role: {
        Args: {
          p_role: Database["public"]["Enums"]["tenant_user_role"];
          p_tenant_id: string;
          p_user_id: string;
        };
        Returns: {
          new_role: Database["public"]["Enums"]["tenant_user_role"];
          old_role: Database["public"]["Enums"]["tenant_user_role"];
        }[];
      };
      tenant_update_member_role_with_limit: {
        Args: { p_max_buffer_seats?: number | null; p_role: Database["public"]["Enums"]["tenant_user_role"]; p_tenant_id: string; p_user_id: string };
        Returns: { new_role: Database["public"]["Enums"]["tenant_user_role"]; old_role: Database["public"]["Enums"]["tenant_user_role"] }[];
      };
      consume_user_email_change_token: {
        Args: { p_token_hash: string };
        Returns: {
          accepted_at: string;
          email: string;
          user_id: string;
        }[];
      };
      consume_user_password_token: {
        Args: { p_password_hash: string; p_token_hash: string };
        Returns: {
          accepted_at: string;
          purpose: Database["public"]["Enums"]["user_token_purpose"];
          user_id: string;
        }[];
      };
      consume_partner_password_token: {
        Args: { p_password_hash: string; p_token_hash: string };
        Returns: { accepted_at: string; partner_id: string; user_id: string }[];
      };
      partner_invite_user: {
        Args: { p_email: string; p_expires_at: string; p_name: string; p_partner_id: string; p_role: Database["public"]["Enums"]["partner_user_role"]; p_tenant_id: string; p_token_hash: string };
        Returns: { accepted_at: string | null; email: string; invited_at: string; name: string; partner_id: string; role: Database["public"]["Enums"]["partner_user_role"]; tenant_id: string; user_id: string }[];
      };
      partner_invite_user_with_limit: {
        Args: { p_email: string; p_expires_at: string; p_max_partner_users?: number | null; p_name: string; p_partner_id: string; p_role: Database["public"]["Enums"]["partner_user_role"]; p_tenant_id: string; p_token_hash: string };
        Returns: { accepted_at: string | null; email: string; invited_at: string; name: string; partner_id: string; role: Database["public"]["Enums"]["partner_user_role"]; tenant_id: string; user_id: string }[];
      };
      partner_resend_invite: {
        Args: { p_expires_at: string; p_partner_id: string; p_tenant_id: string; p_token_hash: string; p_user_id: string };
        Returns: { email: string; name: string; user_id: string }[];
      };
      partner_set_user_status: {
        Args: { p_partner_id: string; p_status: Database["public"]["Enums"]["partner_user_status"]; p_tenant_id: string; p_user_id: string };
        Returns: { new_status: Database["public"]["Enums"]["partner_user_status"]; old_status: Database["public"]["Enums"]["partner_user_status"] }[];
      };
      partner_set_user_status_with_limit: {
        Args: { p_max_partner_users?: number | null; p_partner_id: string; p_status: Database["public"]["Enums"]["partner_user_status"]; p_tenant_id: string; p_user_id: string };
        Returns: { new_status: Database["public"]["Enums"]["partner_user_status"]; old_status: Database["public"]["Enums"]["partner_user_status"] }[];
      };
      admin_create_plan_version: {
        Args: { p_plan_id: string };
        Returns: string;
      };
      admin_attach_addon: {
        Args: {
          p_addon_id: string;
          p_attached_by: string | null;
          p_override_availability: boolean;
          p_subscription_id: string;
        };
        Returns: string;
      };
      admin_detach_addon: {
        Args: { p_subscription_addon_id: string };
        Returns: boolean;
      };
      create_invoice_for_payment: {
        Args: {
          p_tenant_id: string;
          p_subscription_id: string | null;
          p_provider: string;
          p_provider_payment_id: string;
          p_provider_total_cents: number | null;
          p_period_start: string | null;
          p_period_end: string | null;
          p_paid_at: string | null;
          p_lines: Json;
        };
        Returns: { invoice_id: string; number: string; created: boolean; reconciliation: string }[];
      };
      prune_email_log: {
        Args: { p_days?: number };
        Returns: number;
      };
      publish_legal_document: {
        Args: {
          p_doc_type: Database["public"]["Enums"]["legal_doc_type"];
          p_title: string;
          p_content: string;
          p_effective_date: string;
          p_change_summary: string | null;
          p_requires_reacceptance: boolean;
          p_published_by: string | null;
        };
        Returns: Database["public"]["Tables"]["legal_documents"]["Row"];
      };
      clear_reacceptance_requirement: {
        Args: { p_document_id: string };
        Returns: Database["public"]["Tables"]["legal_documents"]["Row"];
      };
      record_legal_acceptance: {
        Args: {
          p_user_id: string;
          p_document_id: string;
          p_ip: string | null;
          p_user_agent: string | null;
          p_context: string;
        };
        Returns: Database["public"]["Tables"]["legal_acceptances"]["Row"];
      };
      outstanding_legal_documents: {
        Args: { p_user_id: string };
        Returns: Database["public"]["Views"]["current_legal_documents"]["Row"][];
      };
      extend_trial: {
        Args: { p_subscription_id: string; p_days: number };
        Returns: { trial_ends_at: string; current_period_end: string }[];
      };
      create_subscription_from_checkout: {
        Args: {
          p_tenant_id: string;
          p_plan_id: string;
          p_billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          p_whop_membership_id: string | null;
          p_trial_days: number;
        };
        Returns: {
          subscription_id: string;
          created: boolean;
          status: Database["public"]["Enums"]["subscription_status"];
        }[];
      };
      claim_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number };
        Returns: boolean;
      };
      prune_rate_limits: {
        Args: Record<string, never>;
        Returns: number;
      };
      compute_metrics_for_date: {
        Args: { p_date: string };
        Returns: Database["public"]["Tables"]["metrics_daily"]["Row"];
      };
      monthly_equivalent_cents: {
        Args: { p_plan_id: string; p_cycle: Database["public"]["Enums"]["billing_cycle"] };
        Returns: number;
      };
      request_credit_note: {
        Args: {
          p_tenant_id: string;
          p_invoice_id: string | null;
          p_type: Database["public"]["Enums"]["credit_note_type"];
          p_amount_cents: number;
          p_reason_code: Database["public"]["Enums"]["credit_reason"];
          p_reason_text: string | null;
          p_requested_by: string;
          p_threshold_cents: number;
        };
        Returns: {
          credit_note_id: string;
          number: string;
          status: Database["public"]["Enums"]["credit_note_status"];
        }[];
      };
      adjust_tenant_credit: {
        Args: { p_tenant_id: string; p_delta_cents: number };
        Returns: number;
      };
      allocate_document_number: {
        Args: { p_series: string; p_at: string };
        Returns: string;
      };
      admin_settle_invoice_manually: {
        Args: {
          p_invoice_id: string;
          p_amount_cents: number;
          p_reference: string;
          p_paid_at: string | null;
          p_recorded_by: string | null;
        };
        Returns: {
          payment_id: string;
          invoice_status: Database["public"]["Enums"]["invoice_status"];
          paid_cents: number;
          settled: boolean;
          subscription_id: string | null;
          subscription_activated: boolean;
        }[];
      };
      admin_set_subscription_pause_state: {
        Args: { p_subscription_id: string; p_pause: boolean };
        Returns: {
          subscription_id: string;
          status: Database["public"]["Enums"]["subscription_status"];
          previous: Database["public"]["Enums"]["subscription_status"];
        }[];
      };
      purchase_credit_pack: {
        Args: {
          p_pack_id: string;
          p_tenant_id: string;
          p_subscription_id: string | null;
          p_quantity: number;
          p_reason: string;
          p_created_by: string | null;
        };
        Returns: {
          invoice_id: string;
          number: string;
          total_cents: number;
          grant_id: string;
          granted_qty: number;
          meter_key: string;
          pack_name: string;
        }[];
      };
      create_custom_invoice: {
        Args: {
          p_tenant_id: string;
          p_subscription_id: string | null;
          p_reason: string;
          p_due_at: string | null;
          p_created_by: string | null;
          p_lines: Json;
        };
        Returns: { invoice_id: string; number: string; total_cents: number }[];
      };
      mark_overdue_invoices: {
        Args: Record<string, never>;
        Returns: number;
      };
      admin_apply_coupon: {
        Args: { p_subscription_id: string; p_coupon_id: string; p_applied_by: string | null };
        Returns: string;
      };
      apply_auto_offer_to_subscription: {
        Args: { p_subscription_id: string };
        Returns: string | null;
      };
      consume_coupon_period: {
        Args: { p_subscription_id: string };
        Returns: number;
      };
      claim_coupon_redemption: {
        Args: { p_coupon_id: string };
        Returns: string;
      };
      allocate_invoice_number: {
        Args: { p_at: string };
        Returns: string;
      };
      refresh_tenant_entitlement: {
        Args: { p_tenant_id: string };
        Returns: Json;
      };
      resolve_tenant_entitlement: {
        Args: { p_tenant_id: string };
        Returns: {
          feature_keys: string[];
          max_seats: number | null;
          meter_allowances: Json;
          plan_id: string | null;
          subscription_status: Database["public"]["Enums"]["subscription_status"] | null;
        }[];
      };
      admin_assign_subscription: {
        Args: {
          p_billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          p_plan_id: string;
          p_start: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      admin_change_subscription_plan: {
        Args: { p_apply_now: boolean; p_new_plan_id: string; p_subscription_id: string };
        Returns: { applied_now: boolean; effective_at: string }[];
      };
      admin_cancel_subscription: {
        Args: { p_immediate: boolean; p_reason: string; p_subscription_id: string };
        Returns: { cancelled_now: boolean; effective_at: string }[];
      };
      advance_billing_periods: {
        Args: never;
        Returns: {
          action: string;
          new_period_end: string;
          new_period_start: string;
          subscription_id: string;
        }[];
      };
      period_end_for: {
        Args: { p_cycle: Database["public"]["Enums"]["billing_cycle"]; p_start: string };
        Returns: string;
      };
      check_meter_capacity: {
        Args: { p_meter_key: string; p_qty: number; p_tenant_id: string };
        Returns: {
          allowed: boolean;
          hard_cap: boolean;
          included: number | null;
          pct_used: number | null;
          reason: string;
          used: number;
        }[];
      };
      // HAND-ADDED for the period billing run, not generated. Ships in
      // supabase/migrations/0017_period_billing.sql.
      bill_subscription_period: {
        Args: {
          p_subscription_id: string;
          p_period_start: string;
          p_period_end: string;
          p_lines: Json;
          p_pending_ids: string[];
          p_reason: string;
          p_credit_cents?: number;
          p_due_at?: string | null;
          p_created_by?: string | null;
        };
        Returns: {
          invoice_id: string | null;
          invoice_number: string | null;
          total_cents: number;
          line_count: number;
          already_billed: boolean;
        }[];
      };
      admin_usage_monitor: {
        Args: { p_over_80?: boolean };
        Returns: {
          tenant_id: string;
          tenant_name: string;
          tenant_status: string;
          meter_key: string;
          meter_label: string;
          unit: string;
          used_qty: number;
          included_qty: number | null;
          grant_qty: number;
          plan_included_qty: number | null;
          hard_cap: boolean;
          percent_used: number | null;
          alert_level: string;
          period_start: string | null;
        }[];
      };
      record_usage: {
        Args: {
          p_idempotency_key: string;
          p_meter_key: string;
          p_qty: number;
          p_ref: string | null;
          p_tenant_id: string;
        };
        Returns: { billing_period_start: string; new_total: number; recorded: boolean }[];
      };
      has_existing_lead_phone: {
        Args: { p_phone_digits: string; p_tenant_id: string };
        Returns: boolean;
      };
      claim_screening_cache: {
        Args: { p_claim_seconds?: number; p_phone_digits: string; p_tenant_id: string; p_version: number };
        Returns: { state: string; result_id: string | null; claim_token: string | null }[];
      };
      complete_screening_cache: {
        Args: {
          p_checked_at: string;
          p_claim_token: string;
          p_expires_at: string;
          p_outcome: string;
          p_phone_digits: string;
          p_raw_response: Json;
          p_tenant_id: string;
          p_vendor: string;
          p_version: number;
          p_warnings: Json;
        };
        Returns: string;
      };
      release_screening_cache: {
        Args: { p_claim_token: string; p_phone_digits: string; p_tenant_id: string; p_version: number };
        Returns: boolean;
      };
      is_tenant_phone_suppressed: { Args: { p_phone_digits: string; p_tenant_id: string }; Returns: boolean };
      start_disposition_walk: { Args: { p_tenant_id: string; p_work_item_id: string; p_user_id: string }; Returns: Json };
      record_disposition_answer: { Args: { p_answer: Json | null; p_node_id: string; p_option_key?: string | null; p_sequence: number; p_tenant_id: string; p_user_id: string; p_walk_id: string; p_work_item_id: string }; Returns: Json };
      complete_disposition: { Args: { p_callback_subtype?: string | null; p_disposition_key: string; p_tenant_id: string; p_user_id: string; p_walk_id: string; p_work_item_id: string }; Returns: Json };
      rebuild_usage_totals: { Args: never; Returns: number };
      tenant_current_period_start: { Args: { p_tenant_id: string }; Returns: string };
      tenant_current_plan: { Args: { p_tenant_id: string }; Returns: string | null };
      tenant_seats_used: { Args: { p_tenant_id: string }; Returns: number };
      admin_save_plan_version: {
        Args: {
          p_feature_keys: string[];
          p_plan_id: string;
          p_price_monthly: number | null;
          p_price_quarterly: number | null;
          p_price_yearly: number | null;
          p_setup_fee: number;
          p_trial_days: number;
        };
        Returns: {
          created_new_version: boolean;
          target_plan_id: string;
          target_version: number;
        }[];
      };
      admin_save_plan_limits: {
        Args: { p_max_affiliates?: number | null; p_max_buffer_seats?: number | null; p_max_marketing_partners?: number | null; p_max_partner_users?: number | null; p_max_publishers?: number | null; p_plan_id: string };
        Returns: Database["public"]["Tables"]["plan_limits"]["Row"];
      };
      admin_update_plan: {
        Args: {
          p_code: string;
          p_description: string | null;
          p_is_archived: boolean;
          p_is_public: boolean;
          p_name: string;
          p_plan_id: string;
          p_sort_order: number;
        };
        Returns: {
          new_code: string;
          new_is_archived: boolean;
          new_name: string;
          old_code: string;
          old_is_archived: boolean;
          old_name: string;
        }[];
      };
      admin_save_template: {
        Args: {
          p_template_id: string | null;
          p_name: string;
          p_product_code: string;
          p_description: string;
          p_is_active: boolean;
          p_fields: Json;
          p_stages: Json;
          p_form_definition: Json;
          p_created_by: string | null;
        };
        Returns: { template_id: string; version: number }[];
      };
      admin_duplicate_template: {
        Args: { p_template_id: string; p_name: string; p_created_by?: string | null };
        Returns: { template_id: string; version: number }[];
      };
      admin_apply_tenant_template: {
        Args: { p_tenant_id: string; p_template_id: string; p_template_version: number; p_product_code: string; p_name: string; p_description: string | null; p_applied_by: string | null; p_fields: Json; p_stages: Json; p_form_definition: Json };
        Returns: string;
      };
      admin_update_tenant_template: {
        Args: { p_tenant_template_id: string; p_tenant_id: string; p_name: string; p_description: string | null; p_fields: Json; p_stages: Json; p_form_definition: Json };
        Returns: string;
      };
      save_form_draft: {
        Args: { p_tenant_id: string; p_partner_id: string | null; p_user_id: string; p_product_code: string; p_tenant_template_id: string; p_definition_version: number; p_payload: Json };
        Returns: string;
      };
      find_partner_lead_duplicates: {
        Args: { p_tenant_id: string; p_phone_digits: string | null; p_full_name: string | null; p_ssn_digits: string | null };
        Returns: { lead_id: string; matched_on: string[] }[];
      };
      claim_transfer_lead: {
        Args: { p_tenant_id: string; p_work_item_id: string; p_user_id: string; p_owner_role: string };
        Returns: Json;
      };
      update_verification_field: {
        Args: { p_tenant_id: string; p_session_id: string; p_work_item_id: string; p_user_id: string; p_field_key: string; p_state: string; p_new_value: Json; p_required_keys: string[]; p_visible_keys: string[]; p_ip?: string | null; p_user_agent?: string | null };
        Returns: Json;
      };
      list_transfer_inbox: {
        Args: { p_tenant_id: string; p_status?: string; p_partner_id?: string | null; p_product_line?: string | null; p_state?: string | null; p_screening_outcome?: string | null; p_claimed_by?: string | null };
        Returns: { id: string; lead_id: string; partner_id: string | null; partner_name: string | null; product_line: string; status: string; owner_user_id: string | null; owner_name: string | null; claimed_at: string | null; queued_at: string; wait_seconds: number; customer: string; age: string; state: string; screening_outcome: string; screening_warning: string | null; duplicate_warning: boolean }[];
      };
      expire_buffer_handoffs: {
        Args: { p_tenant_id: string };
        Returns: number;
      };
      offer_buffer_handoff: {
        Args: { p_tenant_id: string; p_work_item_id: string; p_buffer_user_id: string; p_target_user_id: string; p_timeout_seconds?: number; p_ip?: string | null; p_user_agent?: string | null };
        Returns: Json;
      };
      list_buffer_handoffs: {
        Args: { p_tenant_id: string; p_licensed_agent_id: string };
        Returns: { id: string; work_item_id: string; buffer_user_id: string; buffer_name: string; product_line: string; customer: string; progress_percentage: number; verification_session_id: string; offered_at: string; expires_at: string }[];
      };
      accept_buffer_handoff: {
        Args: { p_tenant_id: string; p_handoff_id: string; p_licensed_agent_id: string; p_ip?: string | null; p_user_agent?: string | null };
        Returns: Json;
      };
      reconcile_partner_intake: {
        Args: never;
        Returns: { lead_id: string; tenant_id: string; submission_id: string | null; missing_steps: string[] }[];
      };
      record_affiliate_link_click: {
        Args: { p_slug: string };
        Returns: { id: string; tenant_id: string; partner_id: string; slug: string; campaign: string | null; click_count: number; partner_name: string; partner_status: string; partner_timezone: string }[];
      };
      admin_login_activity_stats: {
        Args: never;
        Returns: {
          active_last_15_min: number;
          failed_today: number;
          logins_this_week: number;
          logins_today: number;
        }[];
      };
      admin_user_stats: {
        Args: never;
        Returns: {
          active: number;
          inactive: number;
          signed_up_this_month: number;
          suspended: number;
          total: number;
        }[];
      };
      create_tenant_with_owner: {
        Args: {
          p_owner_email: string;
          p_owner_name: string;
          p_owner_password_hash: string;
          p_tenant_name: string;
        };
        Returns: {
          tenant_id: string;
          user_id: string;
        }[];
      };
      self_serve_signup_with_subscription: {
        Args: {
          p_billing_cycle: Database["public"]["Enums"]["billing_cycle"];
          p_owner_email: string;
          p_owner_name: string;
          p_owner_password_hash: string;
          p_plan_id: string;
          p_tenant_name: string;
        };
        Returns: {
          tenant_id: string;
          user_id: string;
          subscription_id: string;
        }[];
      };
      save_tenant_carrier: {
        Args: {
          p_carrier_id: string;
          p_contract_level_bp: number;
          p_effective_from: string;
          p_tenant_id: string;
          p_writing_number: string;
        };
        Returns: Database["public"]["Tables"]["tenant_carriers"]["Row"];
      };
      save_commission_schedule: {
        Args: {
          p_carrier_id: string;
          p_contract_level_bp: number;
          p_effective_from: string;
          p_policy_year: number;
          p_product_code: string;
          p_rate_bp: number;
          p_tenant_id: string;
        };
        Returns: Database["public"]["Tables"]["commission_schedules"]["Row"];
      };
      save_advance_rule: {
        Args: {
          p_advance_months: number;
          p_advance_pct_bp: number;
          p_carrier_id: string;
          p_clawback_months: number;
          p_clawback_type: string;
          p_effective_from: string;
          p_product_code: string;
          p_tenant_id: string;
        };
        Returns: Database["public"]["Tables"]["advance_rules"]["Row"];
      };
      save_appointments: {
        Args: { p_tenant_id: string; p_rows: Json };
        Returns: Database["public"]["Tables"]["appointments"]["Row"][];
      };
      save_license: {
        Args: { p_tenant_id: string; p_state: string; p_license_number: string; p_expires_at: string };
        Returns: Database["public"]["Tables"]["licenses"]["Row"];
      };
      save_eo_policy: {
        Args: { p_tenant_id: string; p_carrier: string; p_policy_number: string; p_expires_at: string; p_coverage_amount_cents: number };
        Returns: Database["public"]["Tables"]["eo_policies"]["Row"];
      };
      save_ce_record: {
        Args: { p_tenant_id: string; p_state: string; p_credits_required: number; p_credits_completed: number; p_deadline: string };
        Returns: Database["public"]["Tables"]["ce_records"]["Row"];
      };
      find_contact_duplicates: {
        Args: { p_tenant_id: string; p_name_search: string; p_dob?: string | null; p_phone?: string | null; p_address_search?: string | null; p_address_hash?: string | null; p_limit?: number };
        Returns: { contact_id: string; household_id: string | null; first_name: string; last_name: string; dob: string | null; primary_phone: string | null; state: string | null; custom_fields: Json; address_line1: string | null; city: string | null; postal_code: string | null; score: number; confidence: string; matched_on: string[] }[];
      };
      save_contact: {
        Args: { p_tenant_id: string; p_first_name: string; p_last_name: string; p_dob: string | null; p_primary_phone: string | null; p_state: string | null; p_name_search: string; p_custom_fields: Json; p_address_hash: string | null; p_address_search: string | null; p_address_line1: string | null; p_city: string | null; p_postal_code: string | null; p_phones?: Json; p_emails?: Json };
        Returns: string;
      };
      save_field_schema: {
        Args: { p_tenant_id: string; p_entity: string; p_field_key: string; p_label: string; p_type: string; p_options: Json; p_is_required: boolean; p_sort_order: number };
        Returns: Database["public"]["Tables"]["field_schema"]["Row"];
      };
      merge_contacts: {
        Args: { p_tenant_id: string; p_kept_id: string; p_merged_id: string; p_field_choices: Json; p_merged_by: string };
        Returns: string;
      };
      undo_contact_merge: {
        Args: { p_tenant_id: string; p_merge_id: string };
        Returns: string;
      };
      create_partner: {
        Args: {
          p_tenant_id: string;
          p_name: string;
          p_partner_type: Database["public"]["Enums"]["partner_type"];
          p_country: string;
          p_contact_name: string;
          p_contact_email: string;
          p_timezone: string;
          p_notes: string;
          p_created_by: string;
          p_max_partners?: number | null;
        };
        Returns: Database["public"]["Tables"]["partners"]["Row"];
      };
      create_partner_with_limits: {
        Args: { p_contact_email: string; p_contact_name: string; p_country: string; p_created_by: string; p_max_affiliates?: number | null; p_max_marketing_partners?: number | null; p_max_publishers?: number | null; p_name: string; p_notes: string; p_partner_type: Database["public"]["Enums"]["partner_type"]; p_tenant_id: string; p_timezone: string };
        Returns: Database["public"]["Tables"]["partners"]["Row"];
      };
      update_partner: {
        Args: {
          p_tenant_id: string;
          p_partner_id: string;
          p_name: string;
          p_partner_type: Database["public"]["Enums"]["partner_type"];
          p_country: string;
          p_contact_name: string;
          p_contact_email: string;
          p_timezone: string;
          p_notes: string;
        };
        Returns: Database["public"]["Tables"]["partners"]["Row"];
      };
      update_partner_with_limits: {
        Args: { p_contact_email: string; p_contact_name: string; p_country: string; p_max_affiliates?: number | null; p_max_marketing_partners?: number | null; p_max_publishers?: number | null; p_name: string; p_notes: string; p_partner_id: string; p_partner_type: Database["public"]["Enums"]["partner_type"]; p_tenant_id: string; p_timezone: string };
        Returns: Database["public"]["Tables"]["partners"]["Row"];
      };
      add_partner_term: {
        Args: {
          p_tenant_id: string;
          p_partner_id: string;
          p_payout_model: Database["public"]["Enums"]["partner_payout_model"];
          p_rate_cents: number | null;
          p_rate_pct_bp: number | null;
          p_effective_from: string;
          p_created_by: string;
        };
        Returns: Database["public"]["Tables"]["partner_terms"]["Row"];
      };
      transition_partner: {
        Args: {
          p_tenant_id: string;
          p_partner_id: string;
          p_next_status: Database["public"]["Enums"]["partner_status"];
          p_confirmation?: string | null;
        };
        Returns: Database["public"]["Tables"]["partners"]["Row"];
      };
      transition_partner_with_limits: {
        Args: { p_confirmation?: string | null; p_max_affiliates?: number | null; p_max_marketing_partners?: number | null; p_max_partner_users?: number | null; p_max_publishers?: number | null; p_next_status: Database["public"]["Enums"]["partner_status"]; p_partner_id: string; p_tenant_id: string };
        Returns: Database["public"]["Tables"]["partners"]["Row"];
      };
      set_tenant_product: {
        Args: { p_is_enabled: boolean; p_product_code: string; p_sort_order?: number | null; p_tenant_id: string };
        Returns: Database["public"]["Tables"]["tenant_products"]["Row"];
      };
      set_partner_product_approval: {
        Args: { p_approved: boolean; p_approved_by: string; p_partner_id: string; p_product_code: string; p_tenant_id: string };
        Returns: boolean;
      };
      list_deal_flow_report: {
        Args: {
          p_agent_id?: string | null;
          p_from_date?: string | null;
          p_page?: number;
          p_page_size?: number;
          p_partner_id?: string | null;
          p_product_line?: string | null;
          p_status?: string | null;
          p_tenant_id: string;
          p_to_date?: string | null;
        };
        Returns: Json;
      };
      partner_lead_pipeline_rows: {
        Args: {
          p_closer_id?: string | null;
          p_date_from?: string | null;
          p_date_to?: string | null;
          p_outcome?: string | null;
          p_partner_id: string;
          p_product?: string | null;
          p_stage_id?: string | null;
          p_tenant_id: string;
        };
        Returns: {
          id: string;
          work_item_id: string;
          customer: string;
          values: Json;
          submitted_at: string;
          updated_at: string;
          product: string;
          stage_id: string;
          stage_name: string;
          stage_type: string;
          stage_color: string;
          stage_position: number;
          stage_archived: boolean;
          pipeline_id: string;
          pipeline_name: string;
          disposition: string | null;
          outcome: string | null;
          outcome_note: string | null;
          submitted_by_id: string | null;
          submitted_by_name: string;
          status: string;
        }[];
      };
      partner_lead_pipeline_payload: {
        Args: {
          p_closer_id?: string | null;
          p_date_from?: string | null;
          p_date_to?: string | null;
          p_outcome?: string | null;
          p_partner_id: string;
          p_product?: string | null;
          p_stage_id?: string | null;
          p_tenant_id: string;
        };
        Returns: Json;
      };
      partner_quality_evidence: {
        Args: { p_from_date: string; p_tenant_id: string; p_to_date: string };
        Returns: { lead_id: string; partner_id: string; lead_date: string; full_name: string; phone: string | null; screening_outcome: string | null; screening_result_outcome: string | null; claimed: boolean; worked: boolean; submitted: boolean; duplicate: boolean; disposition: string | null }[];
      };
      partner_quality_report: {
        Args: { p_from_date?: string | null; p_tenant_id: string; p_to_date?: string | null };
        Returns: Json;
      };
      partner_quality_leads: {
        Args: { p_disposition?: string | null; p_from_date: string; p_metric: string; p_page?: number; p_page_size?: number; p_partner_id: string; p_tenant_id: string; p_to_date: string };
        Returns: Json;
      };
    };
    Enums: {
      legal_doc_type: "tos" | "privacy" | "dpa";
      email_status: "sent" | "failed" | "skipped";
      admin_role: "super_admin" | "support_agent" | "billing_admin" | "platform_config";
      audit_actor_type: "admin" | "tenant" | "system";
      billing_cycle: "monthly" | "quarterly" | "yearly";
      invoice_status: "draft" | "issued" | "paid" | "overdue" | "void" | "uncollectible";
      invoice_line_kind: "plan" | "addon" | "overage" | "discount" | "setup_fee" | "credit";
      billing_mode: "automatic" | "manual";
      trial_reminder_kind: "four_days_left" | "final_day";
      credit_note_type: "refund" | "credit" | "waiver";
      credit_note_status: "pending_approval" | "approved" | "processing" | "succeeded" | "failed" | "rejected";
      credit_reason: "duplicate_charge" | "service_issue" | "goodwill" | "billing_error" | "cancellation" | "other";
      invoice_kind: "subscription" | "custom";
      discount_type: "percent" | "fixed";
      coupon_duration: "once" | "n_periods" | "forever";
      payment_method: "provider" | "manual_bank_transfer";
      payment_status: "succeeded" | "failed" | "pending" | "refunded";
      login_actor_type: "user" | "admin";
      plan_type: "individual" | "agency_no_teams" | "agency_with_teams" | "management";
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "suspended"
        | "paused"
        | "cancelling"
        | "cancelled";
      tenant_status: "provisioning" | "active" | "suspended" | "cancelled";
      tenant_user_role: "owner" | "producer" | "assistant" | "bookkeeper";
      user_status: "pending_verification" | "active" | "inactive" | "suspended" | "deleted";
      user_token_purpose: "invite" | "password_reset" | "email_change" | "email_verification";
      partner_type: "publisher" | "marketing" | "affiliate";
      partner_status: "draft" | "active" | "paused" | "offboarded";
      partner_payout_model: "per_transfer" | "per_lead" | "per_sale" | "per_issued_policy" | "revenue_share";
      partner_user_status: "active" | "revoked";
      partner_user_role: "partner_admin" | "partner_user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
