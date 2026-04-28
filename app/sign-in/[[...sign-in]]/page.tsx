import { SignIn } from "@clerk/nextjs";
import ShaderBackground from "@/components/ShaderBackground";

export default function SignInPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#111113",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* ── Override Clerk pseudo-states & structural styles ── */}
      <style>{`
        /* Placeholder */
        .cl-formFieldInput::placeholder { color: #62626d !important; }
        .cl-formFieldInput::-webkit-input-placeholder { color: #62626d !important; }

        /* Focus ring — orange */
        .cl-formFieldInput:focus {
          box-shadow: 0 0 0 3px rgba(253,114,36,0.18), 0 0 0 1px rgba(253,114,36,0.7) !important;
          outline: none !important;
        }

        /* Social button hover */
        .cl-socialButtonsBlockButton:hover {
          background: rgba(255,255,255,0.07) !important;
          border-color: rgba(255,255,255,0.14) !important;
        }

        /* Footer */
        .cl-footer,
        .cl-footer > *,
        .cl-footerAction,
        .cl-footerAction > *,
        .cl-card > div:last-child {
          background:       transparent !important;
          background-color: transparent !important;
          box-shadow:       none !important;
        }
        .cl-footer {
          border-top: 1px solid rgba(255,255,255,0.07) !important;
        }
        .cl-footerActionText { color: #62626d !important; }
        .cl-footerActionLink { color: #8b8b97 !important; }
        .cl-footerActionLink:hover { color: #fd7224 !important; }

        /* Hide legal links, dim "Secured by Clerk" */
        .cl-footer [data-localization-key="footerPageLink__privacy"],
        .cl-footer [data-localization-key="footerPageLink__terms"],
        .cl-footer [data-localization-key="footerPageLink__help"] { display: none !important; }
        .cl-poweredBy, .cl-footer__poweredBy, .cl-footerPages {
          display: flex !important;
          opacity: 0.25 !important;
          filter: grayscale(1) brightness(2) !important;
          justify-content: center !important;
        }

        /* Dev badge + "Development mode" text hidden until production instance */
        .cl-devBadge,
        [class*="devBadge"] { display: none !important; }
        /* "Development mode" <p> inside footer — targets any footer paragraph without a link child */
        .cl-footer p:not(:has(a)),
        .cl-footerPages p:not(:has(a)) { display: none !important; }

        /* Autofill — match dark input bg */
        .cl-formFieldInput:-webkit-autofill,
        .cl-formFieldInput:-webkit-autofill:hover,
        .cl-formFieldInput:-webkit-autofill:focus {
          -webkit-box-shadow:      0 0 0 100px rgba(255,255,255,0.05) inset !important;
          -webkit-text-fill-color: #f4f4f5 !important;
        }
      `}</style>

      <ShaderBackground />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "#fd7224",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "rgba(253,114,36,0.4) 0px 0px 0px 1px, rgba(255,255,255,0.08) 0px 1px 1px inset, rgba(34,42,53,0.18) 0px 3px 6px",
          }}>
            <i className="ri-image-ai-line" style={{ fontSize: 20, lineHeight: 1, color: "#111113" }} />
          </div>
          <span style={{
            fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em",
            color: "#f4f4f5", fontFamily: "'Space Grotesk', sans-serif",
          }}>
            ImageGen
          </span>
        </div>

        <SignIn
          appearance={{
            variables: {
              colorBackground:      "#1b1b1f",
              colorText:            "#f4f4f5",
              colorTextSecondary:   "#8b8b97",
              colorPrimary:         "#fd7224",
              colorInputBackground: "rgba(255,255,255,0.05)",
              colorInputText:       "#f4f4f5",
              colorNeutral:         "#8b8b97",
              borderRadius:         "6px",
              fontSize:             "14px",
              spacingUnit:          "0.85rem",
            },
            elements: {
              rootBox: {
                background:   "#111113",
                border:       "none",
                boxShadow:    "0px 5px 15px rgba(0,0,0,0.12), 0px 15px 35px -5px rgba(0,0,0,0.28), 0px 0px 0px 1px rgba(255,255,255,0.07)",
                borderRadius: "12px",
                overflow:     "hidden",
              },
              card: {
                background:   "#1b1b1f",
                border:       "none",
                boxShadow:    "none",
                borderRadius: "0",
                padding:      "22px 24px 18px",
              },
              headerTitle: {
                color:       "#f4f4f5",
                fontFamily:  "'Space Grotesk', sans-serif",
                fontWeight:  600,
                fontSize:    "16px",
              },
              headerSubtitle: { color: "#8b8b97", fontSize: "13px" },
              socialButtonsBlockButton: {
                background:   "rgba(255,255,255,0.05)",
                border:       "none",
                boxShadow:    "0px 0px 0px 1px rgba(255,255,255,0.09), 0px 1px 2px rgba(0,0,0,0.2)",
                color:        "#f4f4f5",
                borderRadius: "6px",
              },
              socialButtonsBlockButtonText: { color: "#f4f4f5", fontSize: "13px" },
              dividerLine:  { background: "rgba(255,255,255,0.07)" },
              dividerText:  { color: "#62626d", fontSize: "12px" },
              formFieldLabel: { color: "#8b8b97", fontSize: "12px", fontWeight: 500 },
              formFieldInput: {
                background:   "rgba(255,255,255,0.05)",
                border:       "none",
                boxShadow:    "0px 0px 0px 1px rgba(255,255,255,0.09)",
                color:        "#f4f4f5",
                borderRadius: "6px",
              },
              formButtonPrimary: {
                background:   "#fd7224",
                color:        "#111113",
                borderRadius: "6px",
                fontWeight:   600,
                fontSize:     "14px",
                boxShadow:    "rgba(253,114,36,0.5) 0px 0px 0px 1px, rgba(255,255,255,0.07) 0px 1px 1px inset, rgba(34,42,53,0.2) 0px 2px 3px, rgba(0,0,0,0.24) 0px 1px 1px",
              },
              footer:           { background: "transparent", backgroundColor: "transparent" },
              footerAction:     { background: "transparent" },
              footerActionLink: { color: "#8b8b97" },
              footerActionText: { color: "#62626d" },
              alertText:        { color: "#f87171" },
              identityPreviewText:       { color: "#f4f4f5" },
              identityPreviewEditButton: { color: "#fd7224" },
            },
          }}
        />
      </div>
    </div>
  );
}
