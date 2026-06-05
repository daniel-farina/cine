import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { assetFileUrl, resolveSceneKeyframeId, resolveSceneVideoId } from "./sceneAssets";
import type { CreateAllProgress, StepKind } from "./createAllTypes";
import type { Asset, Scene } from "./types";

function dotClass(
  scene: Scene,
  step: StepKind,
  nextScene: Scene | null | undefined,
  batch: CreateAllProgress | null,
  assets: Asset[]
): string {
  const batchStep = batch?.byScene[scene.id]?.[step];
  if (batchStep === "running") return "running";
  if (batchStep === "error") return "error";
  if (batchStep === "done") return "on";
  if (step === "keyframe" && resolveSceneKeyframeId(scene, assets)) return "on";
  if (step === "video" && resolveSceneVideoId(scene, assets)) return "on";
  if (step === "bridge" && nextScene?.bridgedFromSceneId === scene.id) return "on";
  return "";
}

function Clip({
  scene,
  index,
  active,
  assets,
  nextScene,
  batch,
  batchCurrent,
  dragDisabled,
  onSelect,
}: {
  scene: Scene;
  index: number;
  active: boolean;
  assets: Asset[];
  nextScene?: Scene | null;
  batch: CreateAllProgress | null;
  batchCurrent?: boolean;
  dragDisabled?: boolean;
  onSelect: () => void;
}) {
  const keyframeId = resolveSceneKeyframeId(scene, assets);
  const thumb = assetFileUrl(keyframeId, assets);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: scene.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`clip ${active ? " active" : ""}${isDragging ? " dragging" : ""}${batchCurrent ? " batch-current" : ""}${scene.status === "generating" ? " generating" : ""}`}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      <div className="clip-num">{index + 1}</div>
      <div className="clip-title">
        {scene.title}
        {scene.shotKind === "transition" ? " · move" : ""}
      </div>
      {thumb && <img src={thumb} alt="" className="clip-thumb" />}
      <div className="clip-dots" aria-hidden title="Keyframe · Video · Bridge">
        <span
          className={`dot dot-k ${dotClass(scene, "keyframe", nextScene, batch, assets)}`}
          title="Keyframe"
        />
        <span
          className={`dot dot-v ${dotClass(scene, "video", nextScene, batch, assets)}`}
          title="Video"
        />
        <span
          className={`dot dot-b ${dotClass(scene, "bridge", nextScene, batch, assets)}`}
          title={nextScene ? "Bridge to next" : "—"}
        />
      </div>
    </div>
  );
}

export default function Timeline({
  scenes,
  selectedId,
  assets,
  batch,
  onSelect,
  onReorder,
}: {
  scenes: Scene[];
  selectedId: string | null;
  assets: Asset[];
  batch?: CreateAllProgress | null;
  onSelect: (id: string) => void;
  onReorder: (scenes: Scene[]) => void;
}) {
  const batchActive = Boolean(batch?.active);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (batchActive) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex((s) => s.id === active.id);
    const newIndex = scenes.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(scenes, oldIndex, newIndex));
  };

  return (
    <div className="timeline-scroll" role="region" aria-label="Scene timeline">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={scenes.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="timeline-track">
            {scenes.map((s, i) => (
              <Clip
                key={s.id}
                scene={s}
                index={i}
                active={s.id === selectedId}
                assets={assets}
                nextScene={scenes[i + 1]}
                batch={batch ?? null}
                batchCurrent={batchActive && batch?.sceneIndex === i}
                dragDisabled={batchActive}
                onSelect={() => onSelect(s.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}