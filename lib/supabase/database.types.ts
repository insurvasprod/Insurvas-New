export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  public: {
    Tables: {
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
      plans: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          is_archived: boolean;
          is_public: boolean;
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
      plan_product_access: {
        Row: { plan_id: string; product_code: string; created_at: string };
        Insert: { plan_id: string; product_code: string; created_at?: string };
        Update: { plan_id?: string; product_code?: string; created_at?: string };
        Relationships: [];
      };
      tenant_templates: {
        Row: { id: string; tenant_id: string; template_id: string; template_version: number; product_code: string; name: string; description: string | null; applied_at: string; applied_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; template_id: string; template_version: number; product_code: string; name: string; description?: string | null; applied_at?: string; applied_by?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; template_id?: string; template_version?: number; product_code?: string; name?: string; description?: string | null; applied_at?: string; applied_by?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      tenant_template_fields: {
        Row: { tenant_template_id: string; field_key: string; label: string; type: string; is_required: boolean; options: Json; sort_order: number };
        Insert: { tenant_template_id: string; field_key: string; label: string; type: string; is_required?: boolean; options?: Json; sort_order?: number };
        Update: { tenant_template_id?: string; field_key?: string; label?: string; type?: string; is_required?: boolean; options?: Json; sort_order?: number };
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
          tenant_id: string;
          tenant_template_id: string | null;
          template_id: string;
          template_version: number;
          stage_key: string;
          values: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          tenant_template_id?: string | null;
          template_id: string;
          template_version: number;
          stage_key: string;
          values?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          tenant_template_id?: string | null;
          template_id?: string;
          template_version?: number;
          stage_key?: string;
          values?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
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
        Row: { max_carriers: number | null; max_seats: number | null; plan_id: string };
        Insert: { max_carriers?: number | null; max_seats?: number | null; plan_id: string };
        Update: { max_carriers?: number | null; max_seats?: number | null; plan_id?: string };
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
        };
        Relationships: [];
      };
    };
    Views: {
      admin_plan_list: {
        Row: {
          code: string | null;
          created_at: string | null;
          description: string | null;
          ever_subscribed_count: number | null;
          id: string | null;
          is_archived: boolean | null;
          is_public: boolean | null;
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
    };
    Enums: {
      admin_role: "super_admin" | "support_agent" | "billing_admin" | "platform_config";
      audit_actor_type: "admin" | "system";
      billing_cycle: "monthly" | "quarterly" | "yearly";
      invoice_status: "draft" | "issued" | "paid" | "overdue" | "void" | "uncollectible";
      invoice_line_kind: "plan" | "addon" | "overage" | "discount" | "setup_fee" | "credit";
      billing_mode: "automatic" | "manual";
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
      user_status: "active" | "inactive" | "suspended" | "deleted";
      user_token_purpose: "invite" | "password_reset" | "email_change";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
