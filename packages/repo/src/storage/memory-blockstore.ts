import { CID } from 'multiformats/cid'
import { CommitData, def } from '../types'
import BlockMap from '../block-map'
import { MST } from '../mst'
import DataDiff from '../data-diff'
import { MissingCommitBlocksError } from '../error'
import RepoStorage from './repo-storage'

export class MemoryBlockstore extends RepoStorage {
  blocks: BlockMap
  head: CID | null = null

  constructor(blocks?: BlockMap) {
    super()
    this.blocks = new BlockMap()
    if (blocks) {
      this.blocks.addMap(blocks)
    }
  }

  async getHead(): Promise<CID | null> {
    return this.head
  }

  async getBytes(cid: CID): Promise<Uint8Array | null> {
    return this.blocks.get(cid) || null
  }

  async has(cid: CID): Promise<boolean> {
    return this.blocks.has(cid)
  }

  async getBlocks(cids: CID[]): Promise<{ blocks: BlockMap; missing: CID[] }> {
    return this.blocks.getMany(cids)
  }

  async putBlock(cid: CID, block: Uint8Array): Promise<void> {
    this.blocks.set(cid, block)
  }

  async putMany(blocks: BlockMap): Promise<void> {
    this.blocks.addMap(blocks)
  }

  async indexCommits(commits: CommitData[]): Promise<void> {
    commits.forEach((commit) => {
      this.blocks.addMap(commit.blocks)
    })
  }

  async updateHead(cid: CID, _prev: CID | null): Promise<void> {
    this.head = cid
  }

  async applyCommit(commit: CommitData): Promise<void> {
    this.blocks.addMap(commit.blocks)
    this.head = commit.commit
  }

  async getCommitPath(
    latest: CID,
    earliest: CID | null,
  ): Promise<CID[] | null> {
    let curr: CID | null = latest
    const path: CID[] = []
    while (curr !== null) {
      path.push(curr)
      const commit = await this.readObj(curr, def.commit)
      const root = await this.readObj(commit.root, def.repoRoot)
      if (!earliest && root.prev === null) {
        return path.reverse()
      } else if (earliest && root.prev.equals(earliest)) {
        return path.reverse()
      }
      curr = root.prev
    }
    return null
  }

  async getBlocksForCommits(
    commits: CID[],
  ): Promise<{ [commit: string]: BlockMap }> {
    const commitData: { [commit: string]: BlockMap } = {}
    let prevData: MST | null = null
    for (const commitCid of commits) {
      const commit = await this.readObj(commitCid, def.commit)
      const root = await this.readObj(commit.root, def.repoRoot)
      const data = await MST.load(this, root.data)
      const diff = await DataDiff.of(data, prevData)
      const { blocks, missing } = await this.getBlocks([
        commitCid,
        commit.root,
        ...diff.newCidList(),
      ])
      if (missing.length > 0) {
        throw new MissingCommitBlocksError(commitCid, missing)
      }
      if (!root.prev) {
        const meta = await this.readObjAndBytes(root.meta, def.repoMeta)
        blocks.set(root.meta, meta.bytes)
      }
      commitData[commitCid.toString()] = blocks
      prevData = data
    }
    return commitData
  }

  async sizeInBytes(): Promise<number> {
    let total = 0
    this.blocks.forEach((bytes) => {
      total += bytes.byteLength
    })
    return total
  }

  async destroy(): Promise<void> {
    this.blocks.clear()
  }
}

export default MemoryBlockstore
