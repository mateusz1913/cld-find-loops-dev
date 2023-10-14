import { Connector, SelectionUpdateEvent, StickyNote } from '@mirohq/websdk-types';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

function extractContentFromHTMLString(htmlString: string, space: boolean) {
  const span = document.createElement('span');
  span.innerHTML = htmlString;
  if (space) {
    const children = span.querySelectorAll('*');
    for (let i = 0; i < children.length ; i++) {
      if (children[i].textContent)
        children[i].textContent += ' ';
      else
        (children[i] as HTMLElement).innerText += ' ';
    }
  }
  return [span.textContent || span.innerText].toString().replace(/ +/g,' ');
};

type ItemWithConnectors = StickyNote & { connectors: Connector[] };
type CycleResult = { result: boolean, stackOfVisitedItems: ItemWithConnectors[], isReinforcingCycle: boolean };

function checkIfCycleIsReinforcing(cycle: ItemWithConnectors[]): boolean {
  const negativeEdgesCount = cycle.reduce((acc, curr, i, arr) => {
    const neighbourItem = i === arr.length - 1 ? arr[0] : arr[i + 1];
    const connector = curr.connectors.find((c) => c.end?.item === neighbourItem.id);
    const connectorContent = connector?.captions?.[0].content;

    if (connectorContent) {
      const isNegative = extractContentFromHTMLString(connectorContent, true).trim() === '-'

      if (isNegative) {
        return acc + 1;
      }
    }

    return acc;
  }, 0);

  return negativeEdgesCount % 2 === 0;
}

function findCycleWithDFS(
  graph: ItemWithConnectors[],
  startItem: ItemWithConnectors,
  currentItem: ItemWithConnectors,
  stackOfVisitedItems: ItemWithConnectors[],
  dictionaryOfVisitedItems: Record<string, boolean>,
): CycleResult {
  dictionaryOfVisitedItems[currentItem.id] = true;
  stackOfVisitedItems.push(currentItem)

  for (let i = 0; i < currentItem.connectors.length; i++) {
    const neighbourItemId = currentItem.connectors[i].end?.item;
    const neighbourItem = graph.find((item) => item.id === neighbourItemId)

    if (!neighbourItem) {
      continue;
    }

    if (neighbourItem.id === startItem.id) {
      return { result: true, stackOfVisitedItems, isReinforcingCycle: checkIfCycleIsReinforcing(stackOfVisitedItems) };
    }

    if (dictionaryOfVisitedItems[neighbourItem.id] !== true) {
      const newFindCycle = findCycleWithDFS(
        graph,
        startItem,
        neighbourItem,
        stackOfVisitedItems.slice(),
        {...dictionaryOfVisitedItems},
      );

      if (newFindCycle.result) {
        return newFindCycle;
      }
    }
  }

  return { result: false, stackOfVisitedItems, isReinforcingCycle: false };
}

function compareArrays<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((element, index) => element === b[index]);
}

function compareCycles(left: ItemWithConnectors[], right: ItemWithConnectors[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  
  const leftEdges = left.reduce((acc, curr, i, arr) => {
    if (i === arr.length - 1) {
      return [...acc, `${curr.id}-${arr[0].id}`];
    }

    return [...acc, `${curr.id}-${arr[i+1].id}`];
  }, [] as string[]).sort()
  const rightEdges = right.reduce((acc, curr, i, arr) => {
    if (i === arr.length - 1) {
      return [...acc, `${curr.id}-${arr[0].id}`];
    }

    return [...acc, `${curr.id}-${arr[i+1].id}`];
  }, [] as string[]).sort()


  return compareArrays(leftEdges, rightEdges);
}

const StickyNoteComponent: React.FC<{ item: ItemWithConnectors, graph: ItemWithConnectors[] }> = ({ item, graph }) => {
  const [cycles, setCycles] = React.useState<CycleResult | null>(null);

  React.useEffect(() => {
    const newCycles = findCycleWithDFS(
      graph,
      item,
      item,
      [],
      {},
    );

    setCycles(newCycles);
  }, [item.id]);

  return (
    <div>
      <p>-------------------</p>
      <p>id: {item.id}</p>
      <p>content: {extractContentFromHTMLString(item.content, true)}</p>
      <p>hasCycle: {String(cycles?.result)}</p>
      {cycles?.result ? <div>
        <p>{cycles.stackOfVisitedItems.map((visitedItem) => extractContentFromHTMLString(visitedItem.content, true)).join(' -> ')}</p>
      </div> : null}
    </div>
  )
};

const App: React.FC = () => {
  const [selectedItems, setSelectedItems] = React.useState<ItemWithConnectors[]>([]);
  const [cycles, setCycles] = React.useState<CycleResult[]>([]);

  React.useEffect(() => {
    async function onSelecionUpdate(e: SelectionUpdateEvent) {
      const stickyNoteItems = e.items.filter((item) => {
        return item.type === 'sticky_note';
      }) as StickyNote[];

      const items = await Promise.all(stickyNoteItems.map(async (item) => {
        const allConnectors = await item.getConnectors();
        const connectors = allConnectors.filter((c) => !!c.start?.item && c.start.item === item.id);

        return Object.assign(item, { connectors });
      }));

      const newCycles = items.reduce((acc, curr, _, arr) => {
        const maybeCycle = findCycleWithDFS(
          arr,
          curr,
          curr,
          [],
          {},
        )

        if (!maybeCycle.result) {
          return acc;
        }

        const isNewCycle = acc.every(
          (cycle) => !compareCycles(cycle.stackOfVisitedItems, maybeCycle.stackOfVisitedItems)
        );

        if (isNewCycle) {
          return [...acc, maybeCycle];
        }
        return acc;
      }, [] as CycleResult[])

      setSelectedItems(items);
      setCycles(newCycles);
    }
    miro.board.ui.on('selection:update', onSelecionUpdate);

    return () => {
      miro.board.ui.off('selection:update', onSelecionUpdate);
    };
  }, []);

  return (
    <div className="grid wrapper">
      {/* <div className="cs1 ce12">
        <img src="/src/assets/congratulations.png" alt="" />
      </div> */}
      <div className="cs1 ce12">
        <h1>Select all sticky notes and connectors to identify all the loops</h1>
      </div>
      <div className="cs1 ce12">
        <h2>All cycles</h2>
        {cycles.map((item, i) => {
          return <div key={i}>
            <p>
              {item.isReinforcingCycle ? 'REINFORCING' : 'BALANCING'}
              {': '}
              {
                item.stackOfVisitedItems
                  .map((visitedItem) => extractContentFromHTMLString(visitedItem.content, true))
                  .join(' -> ')
              }
            </p>
          </div>
        })}
      </div>
      <div className="cs1 ce12">
        <h2>All items</h2>
        {selectedItems.map((item, i, arr) => {
          return <div key={i}>
            {item.type === 'sticky_note' ? (
              <StickyNoteComponent
                item={item}
                graph={arr}
              />
            ) : null}
          </div>
        })}
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
