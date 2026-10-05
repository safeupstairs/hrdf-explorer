import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-20 text-center">
      <div className="font-mono text-[80px] leading-none font-extrabold tracking-tighter text-primary">404</div>
      <h1 className="mt-4 text-2xl font-bold">No such record in this export</h1>
      <p className="mt-2 text-muted-foreground">The station, journey, bitfield or file you asked for does not exist in the loaded HRDF data.</p>
      <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-md bg-foreground px-5 font-semibold text-background hover:bg-primary">
        Back to overview
      </Link>
    </div>
  );
}
