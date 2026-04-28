import { SignIn } from "@clerk/nextjs";
import ShaderBackground from "@/components/ShaderBackground";
import { clerkMosaic, signInAppearance } from "@/lib/clerk-appearance";

export default function SignInPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg)",
      position: "relative",
      overflow: "hidden",
    }}>
      <ShaderBackground />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: "linear-gradient(145deg, var(--accent-strong) 0%, var(--accent) 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "var(--mosaic-primary-shadow)",
          }}>
            <i className="ri-image-ai-line" style={{ fontSize: 20, lineHeight: 1, color: clerkMosaic.color.bg }} />
          </div>
          <span style={{
            fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em",
            color: "var(--text-primary)", fontFamily: "var(--font-space)",
          }}>
            ImageGen
          </span>
        </div>

        <SignIn appearance={signInAppearance} />
      </div>
    </div>
  );
}
