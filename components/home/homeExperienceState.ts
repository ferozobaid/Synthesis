export type HomeExperienceState =
  | "hero"
  | "transitioning-to-carousel"
  | "carousel"
  | "transitioning-to-hero";

export type CarouselSlideIndex = 0 | 1 | 2;

export interface HomeExperienceModel {
  experience: HomeExperienceState;
  activeSlide: CarouselSlideIndex;
}

export type HomeExperienceAction =
  | { type: "OPEN_CAROUSEL"; slide: number }
  | { type: "RETURN_TO_HERO" }
  | { type: "FINISH_TRANSITION" }
  | { type: "SET_SLIDE"; slide: number };

export const INITIAL_HOME_EXPERIENCE: HomeExperienceModel = {
  experience: "hero",
  activeSlide: 0,
};

export function clampSlide(slide: number): CarouselSlideIndex {
  return Math.min(2, Math.max(0, Math.round(slide))) as CarouselSlideIndex;
}

export function dragThreshold(viewportWidth: number): number {
  return Math.min(96, Math.max(48, viewportWidth * 0.08));
}

export function hasHorizontalWheelIntent(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) >= 1 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
}

export function isTransitioning(experience: HomeExperienceState): boolean {
  return experience === "transitioning-to-carousel" || experience === "transitioning-to-hero";
}

export function homeExperienceReducer(
  state: HomeExperienceModel,
  action: HomeExperienceAction,
): HomeExperienceModel {
  switch (action.type) {
    case "OPEN_CAROUSEL":
      if (isTransitioning(state.experience)) return state;
      return state.experience === "carousel"
        ? { ...state, activeSlide: clampSlide(action.slide) }
        : {
            experience: "transitioning-to-carousel",
            activeSlide: clampSlide(action.slide),
          };
    case "RETURN_TO_HERO":
      if (state.experience !== "carousel") return state;
      return { ...state, experience: "transitioning-to-hero" };
    case "FINISH_TRANSITION":
      if (state.experience === "transitioning-to-carousel") {
        return { ...state, experience: "carousel" };
      }
      if (state.experience === "transitioning-to-hero") {
        return { ...state, experience: "hero" };
      }
      return state;
    case "SET_SLIDE":
      if (state.experience !== "carousel") return state;
      return { ...state, activeSlide: clampSlide(action.slide) };
    default:
      return state;
  }
}
