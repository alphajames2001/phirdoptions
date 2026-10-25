import { useApp, CONTRACTS, type ContractType } from "@/lib/store";

export function ContractSelector() {
  const contract = useApp((s) => s.contract);
  const setContract = useApp((s) => s.setContract);
  return (
    <div className="inline-flex gap-1 rounded-md bg-card p-1">
      {CONTRACTS.map((c) => {
        const active = c.id === contract;
        return (
          <button
            key={c.id}
            onClick={() => setContract(c.id as ContractType)}
            className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition ${
              active
                ? "bg-white text-neutral-900 shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}