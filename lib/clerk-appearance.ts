import type { NextClerkProviderProps } from "@clerk/nextjs/types";

type ClerkAppearance = NonNullable<NextClerkProviderProps["appearance"]>;
type ClerkLocalization = NonNullable<NextClerkProviderProps["localization"]>;

export const clerkMosaic = {
  color: {
    bg: "#111113",
    surface: "#1b1b1f",
    surface2: "#232328",
    surface3: "#2b2b34",
    text: "#f4f4f5",
    textSecondary: "#8b8b97",
    textMuted: "#62626d",
    accent: "#fd7224",
    accentSoft: "rgba(253,114,36,0.12)",
    accentFocus: "rgba(253,114,36,0.18)",
    border: "rgba(255,255,255,0.09)",
    borderSoft: "rgba(255,255,255,0.07)",
    control: "rgba(255,255,255,0.05)",
    controlHover: "rgba(255,255,255,0.07)",
  },
  radius: {
    control: "6px",
    menu: "10px",
    card: "12px",
  },
  shadow: {
    card: "rgba(0,0,0,0.08) 0px 5px 15px 0px, rgba(0,0,0,0.2) 0px 15px 35px -5px, rgba(255,255,255,0.07) 0px 0px 0px 1px",
    button: "0px 0px 0px 1px rgba(255,255,255,0.10), rgba(255,255,255,0.06) 0px 1px 0px inset, rgba(0,0,0,0.12) 0px 2px 4px",
    primary: "rgb(253,114,36) 0px 0px 0px 1px, rgba(255,255,255,0.07) 0px 1px 1px 0px inset, rgba(34,42,53,0.2) 0px 2px 3px 0px, rgba(0,0,0,0.24) 0px 1px 1px 0px",
    menu: "0px 5px 15px rgba(0,0,0,0.12), 0px 15px 35px -5px rgba(0,0,0,0.28), 0px 0px 0px 1px rgba(255,255,255,0.07)",
  },
} as const;

const variables = {
  colorBackground: "var(--surface)",
  colorText: "var(--text-primary)",
  colorTextSecondary: "var(--text-secondary)",
  colorPrimary: "var(--accent)",
  colorInputBackground: "var(--mosaic-control-bg)",
  colorInputText: "var(--text-primary)",
  colorNeutral: "var(--text-secondary)",
  borderRadius: clerkMosaic.radius.control,
  fontSize: "13px",
  spacingUnit: "0.85rem",
};

export const clerkAppearance = {
  variables,
  elements: {
    card: {
      background: "var(--surface)",
      border: "none",
      boxShadow: "var(--mosaic-card-shadow)",
      borderRadius: clerkMosaic.radius.card,
      overflow: "hidden",
    },
    rootBox: {
      background: "var(--bg)",
      border: "none",
      boxShadow: "var(--mosaic-card-shadow)",
      borderRadius: clerkMosaic.radius.card,
      overflow: "hidden",
    },
    headerTitle: {
      color: "var(--text-primary)",
      fontWeight: 600,
      fontSize: "16px",
    },
    headerSubtitle: { color: "var(--text-secondary)", fontSize: "13px" },
    socialButtonsBlockButton: {
      background: "var(--ck-social-btn-bg)",
      border: "none",
      boxShadow: "var(--mosaic-button-shadow)",
      color: "var(--text-primary)",
      borderRadius: clerkMosaic.radius.control,
    },
    socialButtonsBlockButtonText: { color: "var(--text-primary)", fontSize: "13px" },
    dividerLine: { background: "var(--border-soft)" },
    dividerText: { color: "var(--text-muted)", fontSize: "12px" },
    formFieldLabel: { color: "var(--text-secondary)", fontSize: "12px", fontWeight: 500 },
    formFieldInput: {
      background: "var(--mosaic-control-bg)",
      border: "none",
      boxShadow: "0px 0px 0px 1px var(--ck-field-ring)",
      color: "var(--text-primary)",
      borderRadius: clerkMosaic.radius.control,
    },
    formButtonPrimary: {
      background: "var(--accent)",
      color: "var(--btn-text)",
      borderRadius: clerkMosaic.radius.control,
      fontWeight: 500,
      fontSize: "14px",
      boxShadow: "var(--mosaic-primary-shadow)",
    },
    footer: { background: "transparent", backgroundColor: "transparent" },
    footerAction: { background: "transparent" },
    footerActionLink: { color: "var(--text-secondary)" },
    footerActionText: { color: "var(--text-muted)" },
    alertText: { color: "#f87171" },
    identityPreviewText: { color: "var(--text-primary)" },
    identityPreviewEditButton: { color: "var(--accent)" },
    badge: {
      background: "rgba(255,255,255,0.022)",
      color: "rgba(244,244,245,0.84)",
      WebkitTextFillColor: "rgba(244,244,245,0.84)",
      boxShadow: "0px 0px 0px 1px rgba(255,255,255,0.08)",
      fontSize: "11px",
      fontWeight: 500,
    },
  },
} satisfies ClerkAppearance;

export const clerkLocalization = {
  signIn: {
    start: {
      actionText: "Don't have an account?",
    },
  },
  lastAuthenticationStrategy: "Last used",
} satisfies ClerkLocalization;

// 登录页独立暗色 appearance：全部使用硬编码值，避免 Clerk 内联样式无法解析 CSS 变量
export const signInAppearance = {
  variables: {
    colorBackground: clerkMosaic.color.surface,
    colorText: clerkMosaic.color.text,
    colorTextSecondary: clerkMosaic.color.textSecondary,
    colorPrimary: clerkMosaic.color.accent,
    colorInputBackground: "#33333e",
    colorInputText: clerkMosaic.color.text,
    colorNeutral: clerkMosaic.color.textSecondary,
    borderRadius: clerkMosaic.radius.control,
    fontSize: "14px",
    spacingUnit: "0.85rem",
  },
  elements: {
    ...clerkAppearance.elements,
    card: {
      background: clerkMosaic.color.surface,
      border: "none",
      boxShadow: "none",
      borderRadius: "0",
      padding: "22px 24px 18px",
    },
    formFieldInput: {
      background: "#33333e",
      border: "none",
      boxShadow: `0px 0px 0px 1px ${clerkMosaic.color.border}`,
      color: clerkMosaic.color.text,
      borderRadius: clerkMosaic.radius.control,
    },
    formButtonPrimary: {
      background: clerkMosaic.color.accent,
      backgroundColor: clerkMosaic.color.accent,
      backgroundImage: "none",
      color: "#ffffff",
      WebkitTextFillColor: "#ffffff",
      borderRadius: clerkMosaic.radius.control,
      fontWeight: 600,
      fontSize: "14px",
      boxShadow: clerkMosaic.shadow.primary,
      border: "none",
    },
    socialButtonsBlockButton: {
      background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
      border: "none",
      boxShadow: clerkMosaic.shadow.button,
      color: clerkMosaic.color.text,
      borderRadius: clerkMosaic.radius.control,
    },
    socialButtonsBlockButtonText: {
      color: clerkMosaic.color.text,
      fontSize: "13px",
    },
    badge: {
      background: "rgba(255,255,255,0.022)",
      color: "rgba(244,244,245,0.84)",
      WebkitTextFillColor: "rgba(244,244,245,0.84)",
      boxShadow: "0px 0px 0px 1px rgba(255,255,255,0.08)",
      fontSize: "11px",
      fontWeight: 500,
    },
    footerActionText: {
      color: clerkMosaic.color.textMuted,
      letterSpacing: "normal",
      wordSpacing: "normal",
    },
    footerActionLink: {
      color: clerkMosaic.color.accent,
    },
    otpCodeFieldInput: {
      color: clerkMosaic.color.text,
      WebkitTextFillColor: clerkMosaic.color.text,
      caretColor: clerkMosaic.color.accent,
      background: "#33333e",
      boxShadow: `0 0 0 1.5px rgba(255,255,255,0.16)`,
      borderRadius: clerkMosaic.radius.control,
    },
  },
} satisfies ClerkAppearance;

export const userButtonAppearance = {
  variables,
  elements: {
    rootBox: {
      background: 'transparent',
      boxShadow: 'none',
      borderRadius: '0',
      overflow: 'visible',
    },
    userButtonAvatarBox: { width: 28, height: 28, borderRadius: '999px', overflow: 'hidden', background: 'transparent' },
    avatarBox: { borderRadius: '999px', overflow: 'hidden', background: 'transparent' },
    userButtonPopoverCard: {
      width: "240px",
      minWidth: "240px",
      maxWidth: "240px",
      background: "var(--surface)",
      border: "none",
      boxShadow: "var(--mosaic-card-shadow)",
      borderRadius: clerkMosaic.radius.card,
      padding: "6px",
    },
    userButtonPopoverMain: { padding: "0" },
    userButtonPopoverActions: { padding: "4px 0" },
    userButtonPopoverActionButton: {
      borderRadius: clerkMosaic.radius.control,
      padding: "9px 12px",
      color: "var(--text-primary)",
    },
    userButtonPopoverActionButtonText: {
      color: "var(--text-primary)",
      fontSize: "13px",
    },
    userButtonPopoverActionButtonIcon: { color: "var(--text-secondary)" },
    userButtonPopoverFooter: { display: "none" },
    userPreview: { padding: "12px 14px 10px" },
    userPreviewMainIdentifier: {
      color: "var(--text-primary)",
      fontSize: "14px",
      fontWeight: 600,
    },
    userPreviewSecondaryIdentifier: {
      color: "var(--text-secondary)",
      fontSize: "12px",
    },
  },
} satisfies ClerkAppearance;

export const userProfileAppearance = {
  variables,
  elements: {
    ...clerkAppearance.elements,
    card: {
      background: "var(--surface)",
      boxShadow: "var(--mosaic-card-shadow)",
      border: "none",
      borderRadius: clerkMosaic.radius.card,
      overflow: "hidden",
    },
    navbar: {
      background: "var(--bg)",
      borderRight: "1px solid var(--border-soft)",
      padding: "16px 8px",
      borderRadius: "0",
      gap: "2px",
    },
    navbarButton: {
      color: "var(--text-secondary)",
      borderRadius: clerkMosaic.radius.control,
      padding: "8px 10px",
      gap: "8px",
    },
    navbarButtonText: {
      color: "var(--text-secondary)",
      fontSize: "13px",
      fontWeight: 400,
    },
    navbarButtonIcon: { color: "var(--text-secondary)" },
    pageScrollBox: { background: "var(--surface)" },
    profileSectionTitleText: {
      color: "var(--text-muted)",
      fontSize: "11px",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
    },
    profileSectionPrimaryButton: {
      background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
      border: "none",
      boxShadow: "var(--mosaic-button-shadow)",
      color: "var(--text-secondary)",
      borderRadius: clerkMosaic.radius.control,
      padding: "5px 10px",
      fontSize: "12px",
    },
    headerTitle: {
      color: "var(--text-primary)",
      fontSize: "15px",
      fontWeight: 600,
    },
    headerSubtitle: { color: "var(--text-secondary)", fontSize: "13px" },
    dividerLine: { background: "var(--border-soft)" },
    modalCloseButton: { color: "var(--text-secondary)", borderRadius: clerkMosaic.radius.control },
    menuList: {
      background: "var(--surface)",
      border: "none",
      boxShadow: "var(--mosaic-menu-shadow)",
      borderRadius: clerkMosaic.radius.menu,
    },
    menuItem: { color: "var(--text-secondary)", borderRadius: clerkMosaic.radius.control },
  },
} satisfies ClerkAppearance;
