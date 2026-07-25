export function originalTenderLabel(tenders = []) {
  const tenderTypes = new Set(
    tenders
      .filter((tender) => Number(tender?.refundableAmount) > 0)
      .map((tender) => String(tender?.tenderType || "").toLowerCase())
      .filter(Boolean)
  );

  if (tenderTypes.size === 0) return "Original tender";
  if (tenderTypes.size > 1) return "Original tenders";
  if (tenderTypes.has("cash")) return "Original cash tender";
  if (tenderTypes.has("card")) return "Original card";
  if (tenderTypes.has("gift_card")) return "Original gift card";
  return "Original tender";
}

export function refundSubmitBlockReason({
  refunding,
  previewLoading,
  previewFailed,
  refundable,
  destinationReady,
  cashReady,
  verdict,
}) {
  if (refunding) return "Refund request is being submitted.";
  if (previewLoading) return "Checking the authoritative refundable amount.";
  if (previewFailed) return "Refund details could not be loaded. Retry the preview.";
  if (!(Number(refundable) > 0)) return "No refundable amount is currently available.";
  if (!destinationReady) return "Select and verify the destination gift card.";
  if (!cashReady) return "Confirm the cash payout above before continuing.";
  if (verdict?.canSubmit === false) {
    return verdict.message || "This refund is not currently eligible.";
  }
  return null;
}
