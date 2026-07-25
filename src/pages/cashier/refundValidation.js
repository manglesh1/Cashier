export function validateRefundDestination({
  resolutionMethod,
  destinationGiftCard,
  cashConfirmationRequired,
  cashConfirmed,
}) {
  if (resolutionMethod === "gift_card" && !destinationGiftCard?.giftCardId) {
    return "Look up and select the destination gift card.";
  }
  if (cashConfirmationRequired && !cashConfirmed) {
    return "Confirm that the cash payout will be handed to the customer.";
  }
  return null;
}
