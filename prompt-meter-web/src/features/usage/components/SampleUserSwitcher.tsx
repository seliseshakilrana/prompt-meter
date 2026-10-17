import { FlaskConical, Globe } from "lucide-react";
import { useTimeZone } from "../../../lib/time/TimeZoneProvider";
import { SAMPLE_USERS } from "../data/sampleUsers";
import { useUsageUser } from "../useUsage";

export function SampleUserSwitcher() {
  const { kind, sampleUserId, setSampleUserId } = useUsageUser();
  const { timeZone, setOverride } = useTimeZone();

  if (kind !== "sample") return null;

  const activeUser = SAMPLE_USERS.find((u) => u.userId === sampleUserId) ?? SAMPLE_USERS[0];
  const isTimezoneAligned = timeZone === activeUser.timezone;

  return (
    <div className="section-band mb-4" style={{ marginTop: 0, padding: "14px 18px" }}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <FlaskConical size={20} className="text-[hsl(var(--primary))] shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Sample dataset active</span>
              <span className="pill pill-warn text-xs py-0.5 px-2">Simulated</span>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              Simulating multi-tool usage crossing local midnight boundaries in Asia/Dhaka and Asia/Kolkata.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[hsl(var(--muted-foreground))] font-medium">Sample user:</span>
          <div className="inline-flex rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-0.5">
            {SAMPLE_USERS.map((user) => {
              const isActive = user.userId === sampleUserId;
              return (
                <button
                  key={user.userId}
                  type="button"
                  className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                    isActive
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))]"
                  }`}
                  onClick={() => setSampleUserId(user.userId)}
                >
                  {user.label}
                </button>
              );
            })}
          </div>

          {!isTimezoneAligned ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary))] transition-colors"
              onClick={() => setOverride(activeUser.timezone)}
              title={`Switch portal display zone to ${activeUser.timezone}`}
            >
              <Globe size={13} />
              <span>Align zone ({activeUser.timezone.replace("Asia/", "")})</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
