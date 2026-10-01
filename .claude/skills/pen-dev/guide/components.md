# Components and Instances

- Object that has `reusable` property `true` can be also called a "component" or a "symbol"
- Components will always have a random generated ID. It's not possible to set the ID of a component.
- Components can be used to replicate the same object tree in multiple places, to avoid repetition. This is ideal for common widgets in a design, like buttons, form fields, toggles, cards, etc.
- To reuse a component, use the `ref` object type that points to a reusable component. `ref` objects are also called "instances".
- Instances have a `ref` property, which identifies the mother component.
- The `ref` property of the instance must be set to the reused component's `id`.
- Instances can be customized by overriding objects' properties in their subtree:
  - To override properties of the component's root object, just put the overridden properties in the `ref` object.
  - To override properties of an object inside the component's subtree, use the `descendants` property of the `ref`. Put the overridden properties under the customized object's `id`, path, or unique name inside the `descendants` map. If a name is not unique, use the node ID/path instead. When accessing multi-level descendant nodes in the component, use paths in the `descendants` object keys to access it, DO NOT create multiple levels of `descendants` objects.
  - To override properties of an object inside a nested instance, the object's `id` must be prefixed by the instance's `id` followed by a slash (/). This works for arbitrarily nested component instances, e.g. consider an icon component; and a button component that contains an instance of this icon; and a menu component that contains multiple instances of the button component; and a sidebar component that contains an instance of the menu component!
  - Parts of an instance's object tree can also be replaced with completely new objects: if the `type` property is present for a particular descendant, it means that the whole subtree will be swapped out with the override. In this case, the override must be a complete object tree, not just properties! This mechanism is useful for reusable container-type objects, such as windows, tables, grids, cards, etc.
- An instance can emulate the deletion of a nested object from its subtree by overriding its `enabled` property with `false`.
- You cannot reference components across files. If you want to use a component from a different file you must copy it over.
- Try to use existing components in the document instead of always making new ones.
- Instead of duplicating the same component multiple times with small tweaks. Try to find a way to make them more generic so the instances can use them in more places.
- Overrides will be only applied to the object it's overriding. The changes will not be inherited to all children.
- When parsing designs, treat "component" word broadly - some components are formally defined symbols that can be references, others are ad-hoc groupings that visually or functionally behave like components, sometimes their node name is prefixed "component/"
- When copying nodes and modifying descendants, use the `descendants` property in the Copy operation. Never use separate Update operations for descendants of copied nodes, as this will fail due to ID mismatches.
- An instance (`ref` node) has no `children` of its own - its subtree comes from the component. Do NOT `Get` an instance to discover its children: use the component's child ids you already have (from creating it or from the response mapping) in `instanceId + "/" + componentChildId` paths, or `Get(instanceId, {resolveInstances: true})` if you truly need to read the expanded subtree.
- When modifying component instance descendants:
  - Use `Update(instanceId+"/childId", {...})` to change properties
  - Use `newNodeId=Replace(instanceId+"/childId", {...})` to replace with a new node
  - Use `newNodeId=Insert()` when the parent is a regular frame
- IMPORTANT: DO NOT try to Update a node's descendant that you just copied (Copy), since copying will recreate the descendant nodes and it will assign new IDs to those children nodes.
- Prefer using `fit_content` or `fill_container` size instance override to resize the component instance into the new location.
- When an instance is not inside an object using `layout`, it must be positioned by overriding its `x` and `y` properties. Do this even if the position is (0, 0). Never override just a single position axis. Always override both if you need to specify the position.
- An object must have a specified position, or be a child of an object using horizontal or vertical layout.

**Pattern: Insert instance, then Update descendants**

```js
cardId=Insert("Casf3fX",{type:"ref",ref:"abc",name:"Account Card"})
Update(cardId+"/childTitleId",{content:"Account Details"})
Update(cardId+"/childDescriptionId",{content:"Manage your settings"})
```

**Pattern: Insert instance, then Replace a slot**

```js
cardId=Insert("Casf3fX",{type:"ref",ref:"abc",name:"Account Card"})
customContentId=Replace(cardId+"/contentSlotId",{type:"frame",name:"Content",layout:"vertical"})
item1Id=Insert(customContentId,{type:"text",name:"Item 1",fontFamily:"Inter",content:"Item 1",fill:"#000000"})
```
