export type Database = {
  public: {
    Tables: {
      user_credits: {
        Row: {
          user_id: string;
          email: string;
          credits_remaining: number;
          total_used: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          email: string;
          credits_remaining?: number;
          total_used?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          credits_remaining?: number;
          total_used?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      credit_transactions: {
        Row: {
          id: number;
          user_id: string;
          type: string;
          credits_delta: number;
          order_id: string | null;
          note: string | null;
          granted_by: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          type: string;
          credits_delta: number;
          order_id?: string | null;
          note?: string | null;
          granted_by?: string | null;
          created_at?: string;
        };
        Update: {
          type?: string;
          credits_delta?: number;
          order_id?: string | null;
          note?: string | null;
          granted_by?: string | null;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          user_id: string;
          email: string;
          package_id: string;
          status: string;
          created_at: string;
          confirmed_at: string | null;
          confirmed_by: string | null;
        };
        Insert: {
          id: string;
          user_id: string;
          email: string;
          package_id: string;
          status?: string;
          created_at?: string;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
        };
        Update: {
          status?: string;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
        };
        Relationships: [];
      };
      packages: {
        Row: {
          id: string;
          name: string;
          price_yuan: number;
          credits: number;
          active: boolean;
        };
        Insert: {
          id: string;
          name: string;
          price_yuan: number;
          credits: number;
          active?: boolean;
        };
        Update: {
          name?: string;
          price_yuan?: number;
          credits?: number;
          active?: boolean;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      deduct_credits: {
        Args: { p_user_id: string; p_count: number };
        Returns: number;
      };
      add_credits: {
        Args: { p_user_id: string; p_amount: number };
        Returns: number;
      };
      confirm_order_and_grant_credits: {
        Args: { p_order_id: string; p_admin_email: string };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      cancel_order: {
        Args: { p_order_id: string; p_admin_email: string; p_reason?: string | null };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      admin_adjust_credits: {
        Args: {
          p_user_id: string;
          p_delta: number;
          p_reason: string;
          p_admin_email: string;
        };
        Returns: number;
      };
      auto_cancel_stale_orders: {
        Args: { p_older_than_hours: number };
        Returns: number;
      };
      acquire_generation_lock: {
        Args: { p_user_id: string; p_ttl_seconds?: number };
        Returns: boolean;
      };
      release_generation_lock: {
        Args: { p_user_id: string };
        Returns: null;
      };
    };
  };
};
