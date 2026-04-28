import { SignIn } from "@clerk/nextjs";
import ShaderBackground from "@/components/ShaderBackground";

export default function SignInPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#080808",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* ── Override Clerk internals ── */}
      <style>{`
        /* Placeholder text */
        .cl-formFieldInput::placeholder { color: #555 !important; }
        .cl-formFieldInput::-webkit-input-placeholder { color: #555 !important; }

        /* Footer — inherits dark rootBox bg, divider separates from card */
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

        /* "Don't have an account?" text */
        .cl-footerActionText { color: #555 !important; }
        .cl-footerActionLink { color: #777 !important; }

        /* Hide legal links, keep "Secured by Clerk" but dim it */
        .cl-footer [data-localization-key="footerPageLink__privacy"],
        .cl-footer [data-localization-key="footerPageLink__terms"],
        .cl-footer [data-localization-key="footerPageLink__help"] {
          display: none !important;
        }
        .cl-poweredBy,
        .cl-footer__poweredBy,
        .cl-footerPages {
          display: flex !important;
          opacity: 0.3 !important;
          filter: grayscale(1) brightness(2) !important;
          justify-content: center !important;
        }

        /* Development mode badge — hidden until production instance */
        .cl-devBadge { display: none !important; }

        /* Autofill */
        .cl-formFieldInput:-webkit-autofill,
        .cl-formFieldInput:-webkit-autofill:hover,
        .cl-formFieldInput:-webkit-autofill:focus {
          -webkit-box-shadow:      0 0 0 100px rgba(255,255,255,0.06) inset !important;
          -webkit-text-fill-color: #f0f0f0 !important;
        }
      `}</style>

      <ShaderBackground />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "rgba(255,255,255,0.92)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="ri-image-ai-line" style={{ fontSize: 20, lineHeight: 1, color: "#080808" }} />
          </div>
          <span style={{
            fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em",
            color: "#fff", fontFamily: "'Space Grotesk', sans-serif",
          }}>
            ImageGen
          </span>
        </div>

        <SignIn
          appearance={{
            variables: {
              colorBackground:      "#0f0f0f",
              colorText:            "#efefef",
              colorTextSecondary:   "#7a7a7a",
              colorPrimary:         "#efefef",
              colorInputBackground: "rgba(255,255,255,0.07)",
              colorInputText:       "#efefef",
              colorNeutral:         "#7a7a7a",
              borderRadius:         "8px",
              fontSize:             "14px",
              spacingUnit:          "0.8rem",
            },
            elements: {
              rootBox: {
                background:           "#080808",
                border:               "1px solid rgba(255,255,255,0.14)",
                boxShadow:            "0 32px 64px rgba(0,0,0,0.8)",
                borderRadius:         "14px",
                overflow:             "hidden",
              },
              card: {
                background:           "#0f0f0f",
                border:               "none",
                boxShadow:            "none",
                borderRadius:         "0",
                padding:              "20px 22px 18px",
              },
              headerTitle: {
                color: "#efefef",
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600, fontSize: "16px",
              },
              headerSubtitle: { color: "#7a7a7a", fontSize: "13px" },
              socialButtonsBlockButton: {
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "#efefef", borderRadius: "8px",
              },
              socialButtonsBlockButtonText: { color: "#efefef" },
              dividerLine:  { background: "rgba(255,255,255,0.07)" },
              dividerText:  { color: "#7a7a7a", fontSize: "12px" },
              formFieldLabel: { color: "#7a7a7a", fontSize: "12px" },
              formFieldInput: {
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "#efefef", borderRadius: "8px",
              },
              formButtonPrimary: {
                background: "#efefef", color: "#080808",
                borderRadius: "8px", fontWeight: 600, fontSize: "14px",
              },
              footer:           { background: "transparent", backgroundColor: "transparent" },
              footerAction:     { background: "transparent" },
              footerActionLink: { color: "#7a7a7a" },
              footerActionText: { color: "#7a7a7a" },
              alertText:        { color: "#f87171" },
            },
          }}
        />
      </div>
    </div>
  );
}
