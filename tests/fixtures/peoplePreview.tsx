import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UserProfile } from "../../src/features/social/UserProfile";
import { SocialPanel } from "../../src/features/social/SocialPanel";
import {
  ConsoleWorkspace,
  type WorkspaceRoute,
} from "../../src/features/big-picture/ConsoleWorkspace";
import "../../src/features/big-picture/BigPicture.css";
import { startSocialClient } from "../../src/services/social";
import "../../src/fonts.css";
import "../../src/styles.css";
import "../../src/hydra.css";
function Preview() {
  const [profile, setProfile] = useState<string>();
  const [route, setRoute] = useState<WorkspaceRoute>({
    page: "friends",
    people: true,
  });
  const input = useRef<((key: string) => boolean) | null>(null);
  useEffect(() => startSocialClient(() => {}), []);
  if (new URLSearchParams(location.search).has("big"))
    return (
      <div className="console-mode">
        <ConsoleWorkspace
          route={route}
          input={input}
          active
          onContentFocus={() => {}}
          library={[]}
          emulators={[]}
          jobs={[]}
          refresh={async () => {}}
          notify={() => {}}
          onClose={() => setRoute({ page: "friends", people: true })}
          onMenu={() => {}}
          onRoute={setRoute}
          onImported={() => {}}
        />
      </div>
    );
  return (
    <div
      style={{
        padding: profile ? 0 : 32,
        maxWidth: profile ? "none" : 680,
        margin: "0 auto",
      }}
    >
      {profile ? (
        <UserProfile
          userId={profile}
          onBack={() => setProfile(undefined)}
          onJoinParty={() => alert("Entrando no Party (simulado)")}
          notify={() => {}}
        />
      ) : (
        <SocialPanel
          onProfile={setProfile}
          initialView="people"
          layout="page"
          notify={() => {}}
          onJoinParty={() => {}}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
