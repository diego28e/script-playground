import Image from "next/image";
import { cn } from "@/lib/utils";

// The Academia del Código logo: the circuit "{▶}" mark, cropped from public/logo.png to its drawn area.
// The lab's hub pages ship the same file (infra/lab/hub/static/academia-logo.png).
export function BrandMark({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/logo.png"
      alt=""
      aria-hidden="true"
      width={321}
      height={179}
      priority={priority}
      className={cn("h-8 w-auto shrink-0 select-none", className)}
    />
  );
}
