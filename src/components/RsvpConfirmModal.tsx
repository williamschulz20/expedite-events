"use client";

// Bulk RSVP registers a real person on real events, so it is never one
// click. It only covers Luma (the one source /api/rsvp can register on), is
// capped, and says exactly what will happen before it does.

export const RSVP_CAP = 25;

export function RsvpConfirmModal({
  eligible,
  inView,
  name,
  onConfirm,
  onCancel,
}: {
  eligible: { id: string; title: string }[];
  inView: number;
  name: string | null;
  onConfirm: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const batch = eligible.slice(0, RSVP_CAP);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <h2 className="text-sm font-bold text-gray-900">RSVP to {batch.length} events?</h2>
        <p className="mt-1 text-xs text-gray-500">
          {batch.length === 0
            ? `None of the ${inView} events in view are on Luma, the only site RSVPs can be sent to.`
            : `This registers ${name ?? "you"} on the ${batch.length === RSVP_CAP && eligible.length > RSVP_CAP ? `first ${RSVP_CAP} of ${eligible.length}` : batch.length} hot or warm Luma events in your current view (${inView} in view). Organisers will see the registrations.`}
        </p>
        {batch.length > 0 && (
          <ul className="mt-3 max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
            {batch.map((e) => (
              <li key={e.id} className="truncate">{e.title}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800">
            Cancel
          </button>
          {batch.length > 0 && (
            <button
              type="button"
              onClick={() => onConfirm(batch.map((e) => e.id))}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
            >
              RSVP to {batch.length}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
