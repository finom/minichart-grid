import * as d3 from 'd3';
import * as api from 'biduul-binance-api';
import { last } from 'lodash';

import {
  Scales, StyleMargin, ResizeData, D3Selection, DrawData,
} from './types';
import Plot from './Plot';
import Svg from './Svg';
import ClipPath from './ClipPath';
import Axes from './Axes';
import GridLines from './GridLines';
import Lines from './Lines';
import { ChartType } from '../types';

export default class Chart {
  #svg: Svg;

  #plot: Plot;

  #clipPath: ClipPath;

  #gridLines: GridLines;

  #axes: Axes;

  #lines: Lines;

  #pricePrecision = 1;

  #zoom = d3.zoom();

  #zoomTransform: Pick<d3.ZoomTransform, 'x' | 'y' | 'k'> = { k: 1, x: 0, y: 0 };

  #width = 0;

  #height = 0;

  #hasInitialScroll = false;

  #margin: StyleMargin = {
    top: 0, right: 55, bottom: 30, left: 15,
  };

  #padding: Omit<StyleMargin, 'left'> = {
    top: 50, right: 30, bottom: 20,
  };

  #container: HTMLDivElement;

  #scales: Scales;

  #candles: api.FuturesChartCandle[] = [];

  #chartType: ChartType = 'candlestick';

  constructor(container: HTMLDivElement) {
    const x = d3.scaleTime().range([0, 0]);
    const y = d3.scaleLinear().range([0, 0]);
    const scales: Scales = { x, y, scaledX: x };

    this.#scales = scales;
    this.#container = container;
    this.#svg = new Svg();
    this.#clipPath = new ClipPath();
    this.#plot = new Plot({ scales, resizeData: this.#calcDimensions() });
    this.#axes = new Axes({ scales: this.#scales });
    this.#gridLines = new GridLines({ scales });
    this.#lines = new Lines({ axis: this.#axes.getAxis() });

    this.#initialRender();

    d3.select(this.#container).select('svg').call(
      this.#zoom.on('zoom', (event: d3.D3ZoomEvent<Element, unknown>) => {
        const { transform } = event;

        this.#zoomTransform = transform;

        const scaledX = transform.rescaleX(this.#scales.x);

        this.#scales.scaledX = scaledX;

        this.#axes.update({ scales: this.#scales });
        this.#gridLines.update({ scales: this.#scales });
        this.#plot.update({ scales: this.#scales });
        this.#lines.update();

        this.#draw();
      }) as (selection: D3Selection<d3.BaseType>) => void,
    );

    // zoom only if shift key is pressed
    this.#zoom.filter((evt: MouseEvent) => evt.shiftKey || evt.type !== 'wheel');
  }

  public update = (data: {
    candles?: api.FuturesChartCandle[];
    symbolInfo?: api.FuturesExchangeInfoSymbol | null;
    chartType?: ChartType;
  }): void => {
    if (typeof data.candles !== 'undefined') {
      const isNewInterval = this.#candles[0]?.interval !== data.candles[0]?.interval;
      this.#candles = data.candles;

      this.#draw();

      if (isNewInterval) {
        this.#resize();
        this.#lines.update();
      }
    }

    if (typeof data.symbolInfo !== 'undefined') {
      const pricePrecision = data.symbolInfo?.pricePrecision ?? 0;
      this.#axes.update({ pricePrecision });
      this.#lines.update({ pricePrecision });
      this.#pricePrecision = pricePrecision;
    }

    if (typeof data.chartType !== 'undefined') {
      this.#chartType = data.chartType;
    }

    this.#draw();
  };

  #initialRender = (): void => {
    const resizeData: ResizeData = {
      width: this.#width,
      height: this.#height,
      margin: this.#margin,
      scales: this.#scales,
    };

    // Order of appending = visual z-order (last is top)
    const svgContainer = this.#svg.appendTo(this.#container, resizeData);

    this.#gridLines.appendTo(svgContainer, resizeData);
    this.#plot.appendTo(svgContainer);
    this.#axes.appendTo(svgContainer, resizeData);
    this.#clipPath.appendTo(svgContainer, resizeData);
    this.#lines.appendTo(svgContainer, resizeData);

    new ResizeObserver(() => this.#resize()).observe(this.#container);
  };

  #draw = (): void => {
    const resizeData: ResizeData = this.#calcDimensions();
    const drawData: DrawData = {
      resizeData,
      candles: this.#candles,
      zoomTransform: this.#zoomTransform,
      chartType: this.#chartType,
    };

    this.#calcXDomain();
    this.#calcYDomain();
    this.#axes.draw(resizeData);
    this.#plot.draw(drawData);
    this.#gridLines.draw(resizeData);
    this.#lines.update({
      currentPrice: +(this.#candles[this.#candles.length - 1]?.close ?? 0),
    });

    if (!this.#hasInitialScroll && this.#candles.length) {
      this.#hasInitialScroll = true;
      this.#translateBy(-this.#padding.right);
    }
  };

  #resize = (): void => {
    const resizeData: ResizeData = this.#calcDimensions();
    this.#scales.x.range([0, this.#width]);
    this.#scales.y.range([this.#height, 0]);

    this.#gridLines.resize(resizeData);
    this.#svg.resize(resizeData);
    this.#axes.resize(resizeData);
    this.#clipPath.resize(resizeData);
    this.#lines.resize(resizeData);

    if (this.#candles.length) {
      this.#draw();
      this.#translateBy(0);
    }
  };

  #translateBy = (value: number): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type TodoAny = any;
    d3.select(this.#container).select('svg').call(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      this.#zoom.translateBy as TodoAny,
      value,
    );
  };

  #calcDimensions = (): ResizeData => {
    this.#width = this.#container.offsetWidth - this.#margin.left - this.#margin.right;
    this.#height = this.#container.offsetHeight - this.#margin.top - this.#margin.bottom;

    return {
      width: this.#width,
      height: this.#height,
      margin: this.#margin,
      scales: this.#scales,
    };
  };

  #calcXDomain = (): void => {
    const candles = this.#candles
      .slice(-Math.round(this.#width / 3), this.#candles.length);
    const xDomain = candles.length
      ? [candles[0].time, last(candles)?.time]
      : [new Date(0), new Date()];
    this.#scales.x.domain(xDomain as Iterable<Date | d3.NumberValue>);
  };

  #calcYDomain = (): void => {
    const { y, x } = this.#scales;
    const xDomain = x.domain();
    const candles = this.#candles.filter((candle) => candle.time >= xDomain[0].getTime()
          && candle.time <= xDomain[1].getTime());

    const yDomain: [number, number] = candles.length
      ? [d3.min(candles, (d) => +d.low) as number, d3.max(candles, (d) => +d.high) as number]
      : [0, 1];

    y.domain(yDomain);

    // Padding
    const yPaddingTop = y.invert(-this.#padding.top) - y.invert(0);
    const yPaddingBottom = y.invert(this.#height)
      - y.invert(this.#height + this.#padding.bottom);

    yDomain[1] = (yDomain[1] ?? 0) + (+yPaddingTop.toFixed(this.#pricePrecision));
    yDomain[0] = (yDomain[0] ?? 0) - (+yPaddingBottom.toFixed(this.#pricePrecision));

    y.domain(yDomain);
  };
}
