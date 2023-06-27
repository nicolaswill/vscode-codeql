import { Event, EventEmitter, TreeDataProvider, TreeItem } from "vscode";
import {
  QueryTreeQueryItem,
  QueryTreeTextItem,
  QueryTreeViewItem,
} from "./query-tree-view-item";
import { DisposableObject } from "../common/disposable-object";
import { FileTreeNode } from "../common/file-tree-nodes";

export interface QueryDiscoverer {
  readonly buildQueryTree: () => Array<FileTreeNode<string>> | undefined;
  readonly onDidChangeQueries: Event<void>;
}

export class QueryTreeDataProvider
  extends DisposableObject
  implements TreeDataProvider<QueryTreeViewItem>
{
  private queryTreeItems: QueryTreeViewItem[];

  private readonly onDidChangeTreeDataEmitter = this.push(
    new EventEmitter<void>(),
  );

  public constructor(private readonly queryDiscoverer: QueryDiscoverer) {
    super();

    queryDiscoverer.onDidChangeQueries(() => {
      this.queryTreeItems = this.createTree();
      this.onDidChangeTreeDataEmitter.fire();
    });

    this.queryTreeItems = this.createTree();
  }

  public get onDidChangeTreeData(): Event<void> {
    return this.onDidChangeTreeDataEmitter.event;
  }

  private createTree(): QueryTreeViewItem[] {
    const queryTree = this.queryDiscoverer.buildQueryTree();
    if (queryTree === undefined) {
      return [];
    } else if (queryTree.length === 0) {
      return [this.noQueriesTreeViewItem()];
    } else {
      return queryTree.map(this.convertFileTreeNode.bind(this));
    }
  }

  private convertFileTreeNode(
    fileTreeDirectory: FileTreeNode<string>,
  ): QueryTreeQueryItem {
    return new QueryTreeQueryItem(
      fileTreeDirectory.name,
      fileTreeDirectory.path,
      fileTreeDirectory.data,
      fileTreeDirectory.children.map(this.convertFileTreeNode.bind(this)),
    );
  }

  private noQueriesTreeViewItem(): QueryTreeViewItem {
    return new QueryTreeTextItem(
      "This workspace doesn't contain any CodeQL queries at the moment.",
    );
  }

  /**
   * Returns the UI presentation of the element that gets displayed in the view.
   * @param item The item to represent.
   * @returns The UI presentation of the item.
   */
  public getTreeItem(item: QueryTreeViewItem): TreeItem {
    return item;
  }

  /**
   * Called when expanding an item (including the root item).
   * @param item The item to expand.
   * @returns The children of the item.
   */
  public getChildren(item?: QueryTreeViewItem): QueryTreeViewItem[] {
    if (!item) {
      // We're at the root.
      return this.queryTreeItems;
    } else if (item instanceof QueryTreeQueryItem) {
      return item.children;
    } else {
      return [];
    }
  }
}
