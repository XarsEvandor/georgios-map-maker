/**
 * The "Georgios' Modules" toolbar group, as a canvas layer of its own so it can hold a drag tool:
 * "Map an area" draws a box on a city scene and builds a battle map of what is inside it. The
 * group also holds the Map Maker panel button; Georgios Scribbler adds its buttons to the same
 * group from its own getSceneControlButtons hook.
 */

import { MODULE_ID } from "./lib.js";

/** The companion's limits for an area, metres a side (core city/plans.ts areaPlan). */
const MIN_M = 15;
const MAX_M = 120;
const GOLD = 0xe0a92e;

/**
 * Registers the layer (call during init).
 * @param {{ openPanel: () => void, onArea: (scene: Scene, rect: {x: number, y: number, w: number, h: number}) => Promise<void>, t: (key: string) => string }} opts
 */
export function registerAreaTool({ openPanel, onArea, t }) {
  const InteractionLayer = foundry.canvas.layers.InteractionLayer;

  class GeorgiosLayer extends InteractionLayer {
    /** The box being drawn. */
    #box = null;
    #label = null;

    static get layerOptions() {
      return foundry.utils.mergeObject(super.layerOptions, { name: "georgios", zIndex: 950 });
    }

    static prepareSceneControls() {
      if (!game.user.isGM) return null;
      return {
        name: "georgios",
        order: 20,
        title: "Georgios' Modules",
        icon: "fa-solid fa-dragon",
        layer: "georgios",
        visible: true,
        activeTool: "georgiosArea",
        onChange: (event, active) => {
          if (active) canvas.georgios?.activate();
        },
        tools: {
          georgiosArea: { name: "georgiosArea", order: 0, title: t("AreaTool"), icon: "fa-solid fa-vector-square", visible: true },
          georgiosMapMaker: { name: "georgiosMapMaker", order: 1, title: t("Open"), icon: "fa-solid fa-dungeon", button: true, visible: true, onChange: () => openPanel() },
        },
      };
    }

    /** Is this scene a city (not one of its place maps)? */
    static cityOf(scene) {
      return scene?.getFlag(MODULE_ID, "city") && !scene.getFlag(MODULE_ID, "mapId") ? scene.getFlag(MODULE_ID, "city") : undefined;
    }

    /** Metres per canvas pixel, from the scene's grid (city scenes are 25 or 50 ft a square). */
    static metresPerPixel(scene) {
      const g = scene.grid;
      const ft = g.units === "m" ? g.distance / 0.3048 : g.distance;
      return (ft * 0.3048) / g.size;
    }

    _canDragLeftStart(user) {
      return user.isGM && game.activeTool === "georgiosArea";
    }

    _onDragLeftStart(event) {
      this.#clear();
      if (!GeorgiosLayer.cityOf(canvas.scene)) {
        ui.notifications.warn(t("AreaNotCity"));
        return;
      }
      this.#box = this.addChild(new PIXI.Graphics());
      const style = CONFIG.canvasTextStyle.clone();
      style.fontSize = 26;
      this.#label = this.addChild(new PIXI.Text("", style));
      this.#label.anchor.set(0.5, 1);
    }

    _onDragLeftMove(event) {
      if (!this.#box) return;
      const r = this.#rect(event.interactionData.origin, event.interactionData.destination);
      this.#draw(r);
    }

    async _onDragLeftDrop(event) {
      if (!this.#box) return;
      const scene = canvas.scene;
      let r = this.#rect(event.interactionData.origin, event.interactionData.destination);
      // A click, not a box.
      if (r.w < 8 || r.h < 8) return this.#clear();
      // Too small for a battle map: grow it round its middle to the smallest the companion builds.
      const min = MIN_M / GeorgiosLayer.metresPerPixel(scene);
      if (r.w < min || r.h < min) {
        const w = Math.max(r.w, min), h = Math.max(r.h, min);
        r = this.#inScene({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h });
        this.#draw(r);
      }
      try {
        await onArea(scene, r);
      } finally {
        this.#clear();
      }
    }

    _onDragLeftCancel(event) {
      this.#clear();
    }

    _deactivate() {
      this.#clear();
    }

    /** The box from two corners, cut to the scene and no bigger than the companion builds. */
    #rect(a, b) {
      const max = MAX_M / GeorgiosLayer.metresPerPixel(canvas.scene);
      const dx = Math.max(-max, Math.min(max, b.x - a.x)), dy = Math.max(-max, Math.min(max, b.y - a.y));
      const d = canvas.dimensions;
      const x0 = Math.max(d.sceneX, Math.min(a.x, a.x + dx)), x1 = Math.min(d.sceneX + d.sceneWidth, Math.max(a.x, a.x + dx));
      const y0 = Math.max(d.sceneY, Math.min(a.y, a.y + dy)), y1 = Math.min(d.sceneY + d.sceneHeight, Math.max(a.y, a.y + dy));
      return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }

    /** A box moved (not cut) to lie inside the scene. */
    #inScene(r) {
      const d = canvas.dimensions;
      const x = Math.max(d.sceneX, Math.min(r.x, d.sceneX + d.sceneWidth - r.w));
      const y = Math.max(d.sceneY, Math.min(r.y, d.sceneY + d.sceneHeight - r.h));
      return { x, y, w: Math.min(r.w, d.sceneWidth), h: Math.min(r.h, d.sceneHeight) };
    }

    #draw(r) {
      const g = this.#box;
      g.clear();
      g.beginFill(GOLD, 0.12).lineStyle(4, GOLD, 0.95).drawRect(r.x, r.y, r.w, r.h).endFill();
      const mpp = GeorgiosLayer.metresPerPixel(canvas.scene);
      const ft = (px) => Math.round((px * mpp) / 0.3048 / 5) * 5;
      this.#label.text = `${ft(r.w)} x ${ft(r.h)} ft`;
      this.#label.position.set(r.x + r.w / 2, r.y - 6);
    }

    #clear() {
      this.#box?.destroy();
      this.#label?.destroy();
      this.#box = this.#label = null;
    }
  }

  CONFIG.Canvas.layers.georgios = { layerClass: GeorgiosLayer, group: "interface" };
  return GeorgiosLayer;
}
