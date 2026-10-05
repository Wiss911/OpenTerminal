import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";

export type ProfileBox = {
  time1: number;
  time2: number;
  price1: number;
  price2: number;
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: string;
  text?: string;
  textColor?: string;
};

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type Attached = SeriesAttachedParameter<Time>;

/** Renders the community Price & Volume Profile boxes in the chart's price pane. */
export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private attachedParams: Attached | null = null;
  private boxes: ProfileBox[];
  private readonly view: IPrimitivePaneView;

  constructor(boxes: ProfileBox[]) {
    this.boxes = boxes;
    this.view = {
      renderer: () => ({ draw: (target) => this.draw(target) }),
    };
  }

  attached(param: Attached): void {
    this.attachedParams = param;
  }

  detached(): void {
    this.attachedParams = null;
  }

  updateBoxes(boxes: ProfileBox[]): void {
    this.boxes = boxes;
    this.attachedParams?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  private draw(target: Target): void {
    const attached = this.attachedParams;
    if (!attached || this.boxes.length === 0) return;
    const { chart, series } = attached;
    target.useBitmapCoordinateSpace((scope) => {
      const { context, horizontalPixelRatio: xRatio, verticalPixelRatio: yRatio } = scope;
      for (const box of this.boxes) {
        if (![box.time1, box.time2, box.price1, box.price2].every(Number.isFinite)) continue;
        const x1 = chart.timeScale().timeToCoordinate(box.time1 as Time);
        const x2 = chart.timeScale().timeToCoordinate(box.time2 as Time);
        const y1 = series.priceToCoordinate(box.price1);
        const y2 = series.priceToCoordinate(box.price2);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        const left = Math.min(x1, x2) * xRatio;
        const top = Math.min(y1, y2) * yRatio;
        const width = Math.max(1, Math.abs(x2 - x1) * xRatio);
        const height = Math.max(1, Math.abs(y2 - y1) * yRatio);
        context.fillStyle = box.bgColor ?? "rgba(255, 153, 0, 0.25)";
        context.fillRect(left, top, width, height);
        if (box.borderColor) {
          context.strokeStyle = box.borderColor;
          context.lineWidth = Math.max(1, box.borderWidth ?? 1) * Math.min(xRatio, yRatio);
          context.strokeRect(left, top, width, height);
        }
        if (box.text && width >= 24 * xRatio && height >= 10 * yRatio) {
          context.fillStyle = box.textColor ?? "#fff";
          context.font = `${10 * yRatio}px sans-serif`;
          context.textBaseline = "middle";
          context.fillText(box.text, left + 3 * xRatio, top + height / 2, Math.max(1, width - 6 * xRatio));
        }
      }
    });
  }
}
