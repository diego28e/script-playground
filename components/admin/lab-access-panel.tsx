"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { createLabClient, type LabClientResult } from "@/actions/lab-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEFAULT_REDIRECT = "https://lab.academiadelcodigo.com/hub/oauth_callback";

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" type={secret ? "password" : "text"} onFocus={(event) => event.currentTarget.select()} />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function LabAccessPanel() {
  const [redirectUri, setRedirectUri] = useState(DEFAULT_REDIRECT);
  const [creating, startCreating] = useTransition();
  const [created, setCreated] = useState<Extract<LabClientResult, { success: true }> | null>(null);

  const create = () =>
    startCreating(async () => {
      try {
        const result = await createLabClient(redirectUri.trim());
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        setCreated(result);
        toast.success("Lab client created. Copy the secret now: it is shown only once.");
      } catch {
        toast.error("We couldn't reach the server. Try again.");
      }
    });

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div>
          <h3 className="font-semibold">Create the lab client</h3>
          <p className="text-sm text-muted-foreground">
            Lets the lab hub send students to this platform to sign in. Do this once per hub (production, and your
            computer if you run the lab locally).
          </p>
        </div>
      </div>

      {created ? (
        <div className="space-y-4">
          <CopyField label="OAUTH_CLIENT_ID" value={created.clientId} />
          <CopyField label="OAUTH_CLIENT_SECRET" value={created.clientSecret} secret />
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Put both values in the hub&apos;s <code className="font-mono">.env</code> now. The secret is stored hashed
            and can&apos;t be shown again; if you lose it, create a new client.
          </p>
          <Button variant="outline" onClick={() => setCreated(null)}>
            Done
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="redirect-uri">Hub callback URL</Label>
            <Input id="redirect-uri" value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              The hub&apos;s OAUTH_CALLBACK_URL. For a lab on this computer: http://localhost:8100/hub/oauth_callback
            </p>
          </div>
          <Button type="submit" loading={creating} loadingLabel="Creating…">
            Create client
          </Button>
        </form>
      )}
    </div>
  );
}
