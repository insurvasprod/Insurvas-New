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
          created_at: string;
          id: string;
          name: string;
          onboarding_state: string;
          plan_code: string | null;
          status: Database["public"]["Enums"]["tenant_status"];
          suspended_at: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          onboarding_state?: string;
          plan_code?: string | null;
          status?: Database["public"]["Enums"]["tenant_status"];
          suspended_at?: string | null;
        };
        Update: {
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
