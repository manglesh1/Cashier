export function validateRefundDestination({
  resolutionMethod,
  destinationGiftCard,
  issueNewGiftCard = false,
  cashConfirmationRequired,
  cashConfirmed,
}) {
  if (resolutionMethod === "gift_card" && !issueNewGiftCard && !destinationGiftCard?.giftCardId) {
    return "Look up and select the destination gift card.";
  }
  if (cashConfirmationRequired && !cashConfirmed) {
    return "Confirm that the cash payout will be handed to the customer.";
  }
  return null;
}
