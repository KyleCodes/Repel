// Reserved per manifesto §7. The processing pipeline carries asynchronously
// triggered work — registry (NodeId → handler), topology (event → handlers),
// runner (envelope dispatch). Implementation lands when the second handler
// creates real orchestration need. Until then this directory is shape-only.
export {};
