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
      login_actor_type: "user" | "admin";
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
