import type { DepartureEvent, LegOption, PlannerRequest, TripOption } from "./types";
import { minutesBetween } from "./time";

export const MAX_SHOPPING_BUFFER_MINUTES = 90;

export function buildLegs(boardEvents: DepartureEvent[], alightEvents: DepartureEvent[]): LegOption[] {
  const alightByTrip = new Map<string, DepartureEvent[]>();
  alightEvents.forEach((event) => {
    const existing = alightByTrip.get(event.tripId) ?? [];
    existing.push(event);
    alightByTrip.set(event.tripId, existing);
  });

  return boardEvents.flatMap((board) => {
    const candidates = alightByTrip.get(board.tripId) ?? [];
    return candidates.flatMap((alight) => {
      if (board.routeId !== alight.routeId || board.directionId !== alight.directionId) {
        return [];
      }
      if (board.stopSequence >= alight.stopSequence) {
        return [];
      }
      if (new Date(board.time).getTime() >= new Date(alight.time).getTime()) {
        return [];
      }

      return [
        {
          board,
          alight,
          durationMinutes: minutesBetween(board.time, alight.time),
        },
      ];
    });
  });
}

export function pairTripOptions(outboundLegs: LegOption[], inboundLegs: LegOption[], shoppingMinutes: number): TripOption[] {
  const inboundByDeparture = [...inboundLegs].sort((a, b) => new Date(a.board.time).getTime() - new Date(b.board.time).getTime());
  const options = outboundLegs.flatMap((outbound) => {
    const availableReturns = inboundByDeparture.filter((candidate) => {
      const availableShopping = minutesBetween(outbound.alight.time, candidate.board.time);
      return availableShopping >= 0;
    });

    return availableReturns.map((inbound) => {
      const availableShopping = minutesBetween(outbound.alight.time, inbound.board.time);
      const warnings = buildWarnings(outbound, inbound, shoppingMinutes, availableShopping);

      return {
        id: `${outbound.board.tripId}-${inbound.board.tripId}`,
        outbound,
        inbound,
        shoppingMinutes: availableShopping,
        extraMinutes: availableShopping - shoppingMinutes,
        warnings,
      };
    });
  });

  return options.sort((a, b) => {
    const outboundDiff = new Date(a.outbound.board.time).getTime() - new Date(b.outbound.board.time).getTime();
    if (outboundDiff !== 0) {
      return outboundDiff;
    }
    return a.extraMinutes - b.extraMinutes;
  });
}

export function pairAllTrips(
  request: Pick<PlannerRequest, "shoppingMinutes">,
  homeOutbound: DepartureEvent[],
  storeArrival: DepartureEvent[],
  storeDeparture: DepartureEvent[],
  homeReturn: DepartureEvent[],
): TripOption[] {
  const outboundLegs = buildLegs(homeOutbound, storeArrival);
  const inboundLegs = buildLegs(storeDeparture, homeReturn);
  return pairTripOptions(outboundLegs, inboundLegs, request.shoppingMinutes);
}

export function warningsForCurrentPlan(option: TripOption, requestedShoppingMinutes: number): string[] {
  return buildWarnings(option.outbound, option.inbound, requestedShoppingMinutes, option.shoppingMinutes);
}

function buildWarnings(outbound: LegOption, inbound: LegOption, requestedShoppingMinutes: number, availableShopping: number): string[] {
  const warnings = new Set<string>();
  const allEvents = [outbound.board, outbound.alight, inbound.board, inbound.alight];

  if (availableShopping < requestedShoppingMinutes) {
    warnings.add(`Shopping time dropped to ${availableShopping} minutes.`);
  } else if (availableShopping - requestedShoppingMinutes <= 10) {
    warnings.add(`Only ${availableShopping - requestedShoppingMinutes} minutes of buffer after shopping.`);
  }

  allEvents.forEach((event) => {
    if (event.status) {
      warnings.add(`${event.routeName} ${event.status.toLowerCase()} at ${event.stopId}.`);
    }

    if (event.source === "prediction" && event.scheduleTime) {
      const delay = minutesBetween(event.scheduleTime, event.time);
      if (delay >= 5) {
        warnings.add(`${event.routeName} is ${delay} minutes later than scheduled.`);
      }
    }

    event.alertHeaders.forEach((header) => warnings.add(header));
  });

  return [...warnings];
}
